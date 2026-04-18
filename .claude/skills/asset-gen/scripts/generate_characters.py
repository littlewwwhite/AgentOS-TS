#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
角色图片全自动生成脚本 —— 3 线程 + 队列架构

线程模型：
  线程1(编排+提交): 解析JSON → 建依赖 → 线程池提交生图 → 监听inbox_q → 写JSON
  线程2(轮询):      监听pending_q → check_task_once → 重入队列 → 完成后投inbox_q
  线程3(审核):      监听review_q → subprocess审核 → 结果投inbox_q

队列：
  pending_q : 线程1 → 线程2  (已提交的api_task_id)
  review_q  : 线程1 → 线程3  (待审核的角色)
  inbox_q   : 线程2/3 → 线程1 (生图结果 + 审核结果)

JSON状态文件（仅线程1写入）：
  actor_state_{uuid}.json : 角色状态
  actor_tasks_{uuid}.json  : 任务状态

用法:
  python generate_characters.py \\
    --chars-json "path/to/{}_actors_gen.json" \\
    --project-dir "path/to/project"
"""
import sys, os, json, re, time, argparse, subprocess, shutil, threading, uuid, queue
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from style_generate import load_project_style

# UTF-8 输出
if sys.platform == 'win32':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    elif hasattr(sys.stdout, 'buffer'):
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# awb-login 认证模块
from common_config import get_shared_auth_path
sys.path.insert(0, str(get_shared_auth_path()))

from common_image_api import submit_image_task, check_task_once, download_image, InsufficientCreditsError
from common_gemini_client import rewrite_prompt
from common_create_subjects import process_actor, upload_to_cos
from generate_voices import generate_voice_for_char

# ── 加载配置 ──────────────────────────────────────────────────────────────────
from common_config import get_review_config, get_config
_RC = get_review_config()
_GC = get_config()

# ── 常量 ──────────────────────────────────────────────────────────────────────
CHAR_REVIEW_SCRIPT = Path(__file__).parent / "review_char.py"
MAX_REVIEW_ROUNDS = _RC["review_rounds"]["character"].get("max_ref_review_rounds", 4)
POLL_INTERVAL = 5          # 轮询间隔（秒）
TASK_TIMEOUT = 600         # 单任务超时（秒）
SUBMIT_WORKERS = 10        # 提交线程池大小
POLL_WORKERS = 2           # 轮询线程池大小
REVIEW_WORKERS = 10         # 审核线程池大小

# ── 角色/任务状态常量 ─────────────────────────────────────────────────────────
S_PENDING = "未生成"
S_THREE_VIEW_GENERATING = "三视图进行中"
S_THREE_VIEW_WAIT_REVIEW = "三视图待审核"
S_THREE_VIEW_REVIEWING = "三视图审核中"
S_HEAD_CLOSEUP_GENERATING = "头部特写生成中"
S_HEAD_CLOSEUP_WAIT_REVIEW = "头部特写待审核"
S_HEAD_CLOSEUP_REVIEWING = "头部特写审核中"
S_VOICE_GENERATING = "音色生成中"
S_DONE = "已生成"

T_PENDING = "未开始"
T_RUNNING = "进行中"
T_DONE = "已完成"
T_FAILED = "已失败"

# ── 全局日志 ──────────────────────────────────────────────────────────────────
_log_file = None
_log_lock = threading.Lock()
_thread_local = threading.local()


def setup_logging(workspace_dir):
    global _log_file
    logs_dir = Path(workspace_dir) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file_path = logs_dir / f"actors_gen_{timestamp}.log"
    _log_file = open(log_file_path, 'w', encoding='utf-8')
    print(f"[{time.strftime('%H:%M:%S')}] 日志文件: {log_file_path}", flush=True)
    return log_file_path


def log(msg):
    timestamp = time.strftime('%H:%M:%S')
    prefix = getattr(_thread_local, 'asset_prefix', '')
    formatted = f"[{timestamp}] {prefix}{msg}"
    with _log_lock:
        print(formatted, flush=True)
        if _log_file:
            _log_file.write(formatted + '\n')
            _log_file.flush()


def close_logging():
    global _log_file
    if _log_file:
        _log_file.close()
        _log_file = None


def sanitize_dirname(name):
    return re.sub(r'[/\\:*?"<>|]', '_', name)


def _fmt_elapsed(start_time):
    """格式化从 start_time 到现在的耗时"""
    elapsed = int(time.time() - start_time)
    m, s = divmod(elapsed, 60)
    return f"{m:02d}:{s:02d}"


def split_three_view_image(three_view_path, output_dir):
    """将三视图（16:9横版）切分为三张独立的正面、侧面、背面图（9:16竖版），并上传到COS

    Args:
        three_view_path: 三视图文件路径
        output_dir: 输出目录

    Returns:
        dict: {
            'front': 正面图路径,
            'side': 侧面图路径,
            'back': 背面图路径,
            'front_url': 正面图COS URL,
            'side_url': 侧面图COS URL,
            'back_url': 背面图COS URL
        }
    """
    try:
        from PIL import Image
    except ImportError:
        log("⚠ PIL/Pillow 未安装，无法切分三视图")
        return {'front': None, 'side': None, 'back': None, 'front_url': None, 'side_url': None, 'back_url': None}

    try:
        img = Image.open(three_view_path)
        width, height = img.size

        # 精确计算三等分边界，避免整数除法导致的不均匀
        # 使用浮点数计算，然后四舍五入到最近的整数
        split1 = round(width / 3)
        split2 = round(width * 2 / 3)

        # 切分三个面板
        front_img = img.crop((0, 0, split1, height))
        side_img = img.crop((split1, 0, split2, height))
        back_img = img.crop((split2, 0, width, height))

        # 保存
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        front_path = output_dir / "正面.png"
        side_path = output_dir / "侧面.png"
        back_path = output_dir / "背面.png"

        front_img.save(front_path)
        side_img.save(side_path)
        back_img.save(back_path)

        log(f"  ✓ 三视图已切分: 正面、侧面、背面")

        # 上传到COS
        result = {
            'front': str(front_path),
            'side': str(side_path),
            'back': str(back_path),
            'front_url': None,
            'side_url': None,
            'back_url': None
        }

        view_mapping = {'front': '正面', 'side': '侧面', 'back': '背面'}
        for key, chinese_name in view_mapping.items():
            path = result[key]
            if path and Path(path).exists():
                url, _ = upload_to_cos(path, scene_type="agent-material")
                if url:
                    result[f'{key}_url'] = url
                    log(f"  ✓ {chinese_name}图已上传到COS: {url}")
                else:
                    log(f"  ⚠ {chinese_name}图上传COS失败")

        return result
    except Exception as e:
        log(f"⚠ 切分三视图失败: {e}")
        return {'front': None, 'side': None, 'back': None, 'front_url': None, 'side_url': None, 'back_url': None}


# ── 审核子进程调用 ────────────────────────────────────────────────────────────
def _call_review_subprocess(config, mode, timeout=300):
    """调用审核脚本，直接传递 JSON 字符串"""
    try:
        config_json = json.dumps(config, ensure_ascii=False)
        env = {**os.environ, "PYTHONUTF8": "1"}
        result = subprocess.run(
            [sys.executable, str(CHAR_REVIEW_SCRIPT), "--config", config_json, "--mode", mode],
            env=env, capture_output=True, text=True, timeout=timeout
        )
        if result.stderr:
            for line in result.stderr.strip().split('\n'):
                if line.strip():
                    log(f"    {line}")
        log(f"  审核子进程结果: returncode={result.returncode}, stdout_len={len(result.stdout)}, stderr_len={len(result.stderr)}")
        if result.returncode == 0 and result.stdout.strip():
            for line in reversed(result.stdout.strip().split('\n')):
                line = line.strip()
                if line.startswith('{'):
                    try:
                        rv = json.loads(line)
                        log(f"  审核: {'通过' if rv.get('approved') else '未通过'} — {rv.get('summary', '')}")
                        return rv
                    except json.JSONDecodeError:
                        continue
        log(f"  [WARNING] Gemini review bypassed: script error or unparseable output, defaulting to pass")
        return {"approved": True, "summary": "review bypassed", "issues": [], "review_bypassed": True, "bypass_reason": "script_error_or_no_output"}
    except Exception as e:
        log(f"  [WARNING] Gemini review bypassed: call exception ({e}), defaulting to pass")
        return {"approved": True, "summary": "review bypassed", "issues": [], "review_bypassed": True, "bypass_reason": "call_exception"}


def build_retry_prompt(original_prompt, reason, label="提示词"):
    log(f"  调用 Gemini 重写{label} (原因: {reason[:60]})")
    gemini_prompt = _GC["prompt_templates"]["retry_prompt_rewrite"].format(
        prompt=original_prompt, reason=reason
    )
    try:
        modified = rewrite_prompt(gemini_prompt)
        log(f"  修正后{label}: {modified[:80]}...")
        return modified
    except Exception as e:
        log(f"  Gemini 重写失败，保持原始{label}: {e}")
        return original_prompt


# ══════════════════════════════════════════════════════════════════════════════
# JSON 状态文件读写（仅线程1调用写入）
# ══════════════════════════════════════════════════════════════════════════════

def _write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _init_actor_state(actors_data, run_id, workspace):
    """从 chars_gen.json 构建角色状态 + 任务状态，写入 workspace。"""
    actors = actors_data['actors']

    actor_state = {}   # state_id → {...}
    task_state = {}    # prompt_id → {...}

    for actor in actors:
        actor_id = actor['actor_id']
        actor_name = actor['actor_name']
        states = actor['states']

        # 找到默认state（is_default=True），如果没有则取第一个
        default_state = next((f for f in states if f.get('is_default', False)), states[0] if states else None)
        default_state_id = None

        for state in states:
            # 为每个state生成唯一ID

            state_id = state['state_id']

            state_name = state['state_name']
            is_default = state.get('is_default', False)

            # 记录默认state的ID
            if is_default or (default_state and state == default_state):
                default_state_id = state_id
                is_default = True

            # 非默认state依赖于默认state
            depends_on = None if is_default else default_state_id

            actor_state[state_id] = {
                "state_id": state_id,
                "actor_id": actor_id,
                "actor_name": actor_name,
                "state_name": state_name,
                "is_default": is_default,
                "depends_on": depends_on,
                "iref_url": None,  # 用于存储默认state的图片URL，供变体state使用
                "status": S_PENDING,  # 角色状态流转: 未生成→三视图进行中→三视图待审核→三视图审核中→已生成
                "round": 0,
                "description": state.get('description', ''),
                "episodes": state.get('episodes', []),
                # 该state下每个prompt的完成状态 {prompt_id: 任务状态}
                "prompts": {p['prompt_id']: T_PENDING for p in state['three_view_prompts']},
                "main_task_id": state['three_view_prompts'][0]['prompt_id'],
                "path_dict": {},  # 存储本地文件路径 {"three": "path", "front": "path", "back": "path", "side": "path", "voice": "path"}
                "url_dict": {},  # 存放生成的图片地址 {"three": "url", "front": "url", "back": "url", "side": "url","voice":"url"}
                "element_id": None,
            }

            for p in state['three_view_prompts']:
                task_state[p['prompt_id']] = {
                    "prompt_id": p['prompt_id'],
                    "state_id": state_id,
                    "actor_id": actor_id,
                    "prompt": p['prompt'],
                    "api_task_id": None,
                    "status": T_PENDING,
                    "image_path": None,
                    "show_url": None,
                    "score": None,
                    "reject_reason": None,
                    "created_at": None,
                    "timeout": TASK_TIMEOUT,
                }

    char_path = Path(workspace) / f"actor_state_{run_id}.json"
    task_path = Path(workspace) / f"actor_tasks_{run_id}.json"
    _write_json(char_path, actor_state)
    _write_json(task_path, task_state)
    return actor_state, task_state, char_path, task_path


# ══════════════════════════════════════════════════════════════════════════════
# 线程2：轮询线程
# ══════════════════════════════════════════════════════════════════════════════

def _poller_thread(pending_q, inbox_q, stop_event, temp_dir):
    """监听 pending_q，非阻塞轮询 API 状态，完成后投 inbox_q。"""
    log("[线程2-轮询] 启动")

    def _check_once(ticket):
        _thread_local.asset_prefix = f"【{ticket.get('actor_name', '')}】"
        msg_type = ticket.get('msg_type', 'gen_result')
        now = time.time()
        # 未到下次查询时间，直接丢回
        if now < ticket.get('next_check_at', 0):
            pending_q.put(ticket)
            return
        # 超时检查
        if now - ticket.get('created_at', now) > ticket.get('timeout', TASK_TIMEOUT):
            log(f"  [轮询] {ticket['prompt_id'][:8]}... 超时")
            inbox_q.put({
                "type": msg_type, "prompt_id": ticket['prompt_id'],
                "state_id": ticket['state_id'], "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "超时", "image_url": None,
            })
            return
        # 单次查询
        resp = check_task_once(ticket['api_task_id'])
        api_status = resp.get('status', 'UNKNOWN')

        if api_status in ('SUCCESS', 'FAIL', 'FAILED', 'ERROR'):
            log(f"  [轮询] prompt_id={ticket.get('prompt_id', 'N/A')[:8]}..., api_task_id={ticket.get('api_task_id', 'N/A')}, api_status={api_status}")

        if api_status == 'SUCCESS':
            result_urls = resp.get('result_urls', [])
            display_urls = resp.get('display_urls', [])
            img_path = None
            if result_urls:
                dst = Path(temp_dir) / sanitize_dirname(ticket.get('actor_name', '')) / f"{ticket['prompt_id']}_r{ticket.get('round', 1)}.png"
                img_path = download_image(result_urls[0], dst)
            show_url = display_urls[0] if display_urls else (result_urls[0] if result_urls else None)
            inbox_q.put({
                "type": msg_type, "prompt_id": ticket['prompt_id'],
                "state_id": ticket['state_id'], "status": T_DONE,
                "image_path": img_path, "show_url": show_url, "reason": "", "image_url":result_urls[0]
            })
        elif api_status in ('FAIL', 'FAILED'):
            log(f"  [轮询] {ticket['prompt_id'][:8]}... 生成失败: {resp.get('error_msg', '')}")
            inbox_q.put({
                "type": msg_type, "prompt_id": ticket['prompt_id'],
                "state_id": ticket['state_id'], "status": T_FAILED,
                "image_path": None, "show_url": None, "image_url": None,
                "reason": resp.get('error_msg', '生成失败'),
            })
        elif api_status == 'ERROR':
            # API 请求本身出错，增加重试计数
            ticket['error_count'] = ticket.get('error_count', 0) + 1
            if ticket['error_count'] >= 20:
                inbox_q.put({
                    "type": msg_type, "prompt_id": ticket['prompt_id'],
                    "state_id": ticket['state_id'], "status": T_FAILED,
                    "image_path": None, "show_url": None, "reason": "连续查询错误", "image_url": None,
                })
            else:
                ticket['next_check_at'] = now + POLL_INTERVAL
                pending_q.put(ticket)
        else:
            # PROCESSING / QUEUE 等，渐进式间隔
            check_count = ticket.get('check_count', 0) + 1
            ticket['check_count'] = check_count
            ticket['next_check_at'] = now + 10
            pending_q.put(ticket)

    with ThreadPoolExecutor(max_workers=POLL_WORKERS) as pool:
        while not stop_event.is_set():
            try:
                ticket = pending_q.get(timeout=0.1)
                if ticket is None:
                    break
                pool.submit(_check_once, ticket)
            except queue.Empty:
                continue
    log("[线程2-轮询] 退出")


# ══════════════════════════════════════════════════════════════════════════════
# 线程3：审核线程
# ══════════════════════════════════════════════════════════════════════════════

def _reviewer_thread(review_q, inbox_q, stop_event, temp_dir, style_data):
    """监听 review_q，调用审核子进程，结果投 inbox_q。"""
    log("[线程3-审核] 启动")

    def _do_review(ticket):
        state_id = ticket['state_id']
        actor_name = ticket['actor_name']
        _thread_local.asset_prefix = f"【{actor_name}】"
        review_type = ticket.get('review_type', 'three_view')

        # ── 头部特写审核分支 ──────────────────────────────────────────────
        if review_type == 'head_closeup':
            head_closeup_path = ticket.get('head_closeup_path', '')
            front_image_path = ticket.get('front_image_path', '')
            config = {
                "actor_name": actor_name,
                "actors": [{
                    "name": actor_name,
                    "form": ticket.get('state_name', ''),
                    "image": head_closeup_path,
                    "front_image": front_image_path,
                }]
            }

            log(f"  [头部特写审核] 角色「{actor_name}」开始头部特写审核...")
            rv = _call_review_subprocess(config, "head_closeup")
            log(f"  [头部特写审核] 角色「{actor_name}」结果: {rv}")

            approved = rv.get('approved', True)
            reason = ''
            issues = rv.get('issues', [])
            if issues:
                for issue in issues:
                    if issue.get('severity') == 'high':
                        approved = False
                        reason = issue.get('reason', '')
                        break

            inbox_q.put({
                "type": "head_review_result", "state_id": state_id,
                "approved": approved, "reason": reason,
                "summary": rv.get('summary', ''),
            })
            return

        # ── 三视图审核分支 ────────────────────────────────────────────────
        candidates = ticket.get('candidates', [])
        _thread_local.asset_prefix = f"【{actor_name}】"

        # 兼容旧格式（单个图片）
        if not candidates and 'image_path' in ticket:
            candidates = [{
                "prompt_id": "legacy",
                "image_path": ticket['image_path'],
                "prompt": ticket['prompt'],
            }]

        # 构建审核配置，包含所有候选图片
        config = {
            "state_id": state_id,
            "actor_name": actor_name,
            "actors": [
                {
                    "name": cand['prompt_id'],  # 直接用 prompt_id 作为唯一标识
                    "state_name": ticket.get('state_name', ''),
                    "image": cand['image_path'],
                    "prompt": cand['prompt'],
                    "is_reused": False,
                    "script_context": ticket.get('script_context', ''),
                }
                for i, cand in enumerate(candidates)
            ]
        }
        if style_data:
            config["worldview_type"] = style_data.get('worldview_type', '通用')
            config["visual_mode"] = style_data.get('visual_mode', '')
            config["character_style"] = style_data.get('character_style', {})
            config["anti_contamination"] = style_data.get('anti_contamination', '')

        log(f"  [审核] 角色「{actor_name}」开始审核（共{len(candidates)}个候选）...")
        rv = _call_review_subprocess(config, "three_view")
        log(f"  [审核] 角色「{actor_name}」审核结果 {rv}...")
        # 从审核结果中提取每个候选的评分
        scores = rv.get('scores', [])
        issues = rv.get('issues', [])

        # 收集所有候选的评分信息和驳回原因
        candidate_scores = {}  # {prompt_id: score_info}
        best_candidate = None
        best_score = -1
        best_prompt_id = None

        for i, cand in enumerate(candidates):
            # 直接用 prompt_id 匹配（与传给审核脚本的 name 字段一致）
            score_entry = next((s for s in scores if s.get('name') == cand['prompt_id']), None)
            issue_entry = next((iss for iss in issues if iss.get('name') == cand['prompt_id']), None)

            if score_entry:
                total_score = score_entry.get('total', 0)
                reject_reason = ''
                if issue_entry:
                    reject_reason = f"[{issue_entry.get('severity', 'unknown')}] {issue_entry.get('reason', '')}"

                candidate_scores[cand['prompt_id']] = {
                    'total': total_score,
                    'structure': score_entry.get('structure', 0),
                    'material': score_entry.get('material', 0),
                    'design': score_entry.get('design', 0),
                    'penalty': score_entry.get('penalty', 0),
                    'reason': score_entry.get('reason', ''),
                    'reject_reason': reject_reason,
                }
                log(f"    候选{i+1} (prompt_id={cand['prompt_id'][:8]}...) 评分: {total_score}{' - ' + reject_reason if reject_reason else ''}")
                if total_score > best_score:
                    best_score = total_score
                    best_candidate = cand
                    best_prompt_id = cand['prompt_id']

        # 如果没有评分信息，默认选择第一个
        if best_candidate is None and candidates:
            best_candidate = candidates[0]
            best_prompt_id = candidates[0]['prompt_id']
            log(f"    未找到评分信息，默认选择第一个候选")

        # 判断是否通过：检查最佳候选是否有严重问题
        approved = True
        reason = ''
        if issues:
            # 检查最佳候选对应的问题（用 prompt_id 匹配）
            for issue in issues:
                if issue.get('name') == best_prompt_id:
                    if issue.get('severity') == 'high':
                        approved = False
                        reason = issue.get('reason', '')
                        break

        log(f"  [审核结果] 角色「{actor_name}」最佳候选评分: {best_score:.2f}, {'通过' if approved else '未通过'}")

        inbox_q.put({
            "type": "review_result", "state_id": state_id,
            "approved": approved, "reason": reason,
            "summary": rv.get('summary', ''),
            "best_prompt_id": best_prompt_id,
            "best_score": best_score,
            "candidate_scores": candidate_scores,  # 所有候选的评分信息
        })

    with ThreadPoolExecutor(max_workers=REVIEW_WORKERS) as pool:
        while not stop_event.is_set():
            try:
                ticket = review_q.get(timeout=0.1)
                if ticket is None:
                    break
                log(f"  [审核队列] 收到审核任务: state_id={ticket.get('state_id', 'N/A')}, actor_name={ticket.get('actor_name', 'N/A')}, ticket: {ticket}")
                pool.submit(_do_review, ticket)
            except queue.Empty:
                continue
    log("[线程3-审核] 退出")

def _stage_char_images_single(ss, ts, temp_dir):
    """将最佳候选三视图暂存到 temp 目录（角色全部完成后再统一复制到输出目录）

    Args:
        ss: actor_state[state_id] 角色状态对象
        ts: task_state[best_prompt_id] 任务状态对象
        temp_dir: 暂存根目录
    """
    actor_name = ss['actor_name']
    state_name = ss['state_name']
    safe_actor_name = sanitize_dirname(actor_name)
    safe_state_name = sanitize_dirname(state_name)
    stage_dir = Path(temp_dir) / safe_actor_name / safe_state_name
    stage_dir.mkdir(parents=True, exist_ok=True)

    dst = None
    if ts.get('image_path') and Path(ts['image_path']).exists():
        dst = stage_dir / "三视图.png"
        shutil.copy2(ts['image_path'], str(dst))
        log(f"  角色「{actor_name}」→ temp/{safe_actor_name}/{safe_state_name}/三视图.png（最佳候选）")

    return dst, stage_dir



# ══════════════════════════════════════════════════════════════════════════════
# 音色生成
# ══════════════════════════════════════════════════════════════════════════════

def run_voice_generation(actor_data, temp_dir):
    """
    为 all_chars 中的角色生成音色（单角色调用，无需内部并发）。

    直接从 all_chars（原始 JSON 数据）读取角色级 voice_text / voice_desc，
    音频文件写入暂存目录（temp_dir/{char}/{default_state}/voice.mp3）。
    """
    voice_path = ""
    cos_url = ""

    actor_name = actor_data['actor_name']
    actor_id   = actor_data.get('actor_id', actor_name)
    voice_text = actor_data.get('voice_text', '')
    voice_desc = actor_data.get('voice_desc', '')

    default_state = next((f for f in actor_data.get('states', []) if f.get('is_default')), None)
    safe_actor_name  = sanitize_dirname(actor_name)
    safe_state_name  = sanitize_dirname(default_state['state_name'])
    output_path = Path(temp_dir) / safe_actor_name / safe_state_name / "voice.mp3"
    item = {
        "actor_id":    actor_id,
        "actor_name":  actor_name,
        "voice_text":  voice_text,
        "voice_desc":  voice_desc,
        "output_path": str(output_path),
    }
    try:
        _, voice_path, cos_url = generate_voice_for_char(item)
        if voice_path:
            log(f"  ✅ 音色生成完成: {actor_name} → {voice_path}")
            if cos_url:
                log(f"  ✅ 音色 COS URL: {cos_url}")
        else:
            log(f"  ⚠ 音色生成失败: {actor_name}")
    except Exception as e:
        log(f"  ⚠ 音色异常: {actor_name}: {e}")
    return voice_path, cos_url


# ── 辅助：为角色创建主体 ─────────────────────────────────────────────────────
def _try_create_subject(ss):
    """尝试为角色创建主体（上传正面图到AWB），返回 element_id 或 None。

    Args:
        ss: 角色状态对象
    """
    log(f"  [DEBUG] _try_create_subject 开始: {ss['actor_name']}")

    # 0. 检查是否有必要的图片资源
    if not ss.get('url_dict'):
        ss['url_dict'] = {}

    if not ss.get('path_dict'):
        ss['path_dict'] = {}

    log(f"  [DEBUG] url_dict keys: {list(ss['url_dict'].keys())}")
    log(f"  [DEBUG] path_dict keys: {list(ss['path_dict'].keys())}")

    # 2. 获取正面图URL（优先 head > front）
    frontal_image_url = ss['url_dict'].get('head') or ss['url_dict'].get('front')
    log(f"  [DEBUG] frontal_image_url: {frontal_image_url}")

    # 如果没有正面图，无法创建主体
    if not frontal_image_url:
        log(f"  ⚠ 角色「{ss['actor_name']}」缺少正面图 URL，跳过创建主体")
        return None

    # 3. 获取参考图列表（front, back, side）
    refer_urls = []
    for key in ['front', 'back', 'side']:
        url = ss['url_dict'].get(key)
        if url:
            refer_urls.append(url)

    log(f"  [DEBUG] refer_urls: {refer_urls}")

    # 4. 获取音频URL
    voice_url = ss['url_dict'].get('voice') or None
    log(f"  [DEBUG] voice_url: {voice_url}")

    # 5. 调用 process_actor 创建主体
    description = ss.get('description', ss['actor_name'])[:95]
    log(f"  [DEBUG] 准备调用 process_actor: name={ss['actor_name']}, desc={description[:50]}, frontal_image_url={frontal_image_url}, refer_urls={refer_urls}, voice_url={voice_url}...")

    element_id = process_actor(
        element_name=ss['actor_name'],
        element_description=description,
        element_frontal_image=frontal_image_url,
        dry_run=False, voice_path=voice_url,
        element_refer_list=refer_urls if refer_urls else None
    )
    log(f"  [DEBUG] process_actor 返回: {element_id}")

    if element_id:
        ss['element_id'] = element_id
        log(f"  ✅ 角色主体创建成功: {ss['actor_name']} → {element_id}")
        return element_id

    return None


def _finalize_char_to_output(ss, project_dir, temp_dir):
    """将单个角色 state 的所有暂存文件从 temp 复制到最终输出目录，并增量更新 actors.json

    Args:
        ss: actor_state[state_id] 角色状态对象
        project_dir: 项目输出目录
        temp_dir: 暂存根目录
    """
    actor_id = ss.get('actor_id', '')
    actor_name = ss['actor_name']
    state_name = ss['state_name']
    safe_actor_name = sanitize_dirname(actor_name)
    safe_state_name = sanitize_dirname(state_name)

    # 暂存目录（temp） → 最终输出目录
    src_dir = Path(temp_dir) / safe_actor_name / safe_state_name
    dst_dir = Path(project_dir) / "actors" / safe_actor_name / safe_state_name
    dst_dir.mkdir(parents=True, exist_ok=True)

    # 只复制最终文件到输出目录（跳过轮询下载的临时候选图片）
    _FINAL_FILES = ('三视图.png', '正面.png', '侧面.png', '背面.png', '头部特写.png', 'voice.mp3')
    # 写入前先删除旧文件，确保不残留过时内容
    for name in _FINAL_FILES:
        old = dst_dir / name
        if old.exists():
            old.unlink()
    if src_dir.exists():
        for name in _FINAL_FILES:
            f = src_dir / name
            if f.exists():
                dst_file = dst_dir / name
                shutil.copy2(str(f), str(dst_file))
                log(f"  [输出] 角色「{actor_name}」→ actors/{safe_actor_name}/{safe_state_name}/{name}")

    # 更新 path_dict 指向最终输出路径
    for key, filename in [('front', '正面.png'), ('side', '侧面.png'), ('back', '背面.png'),
                          ('three', '三视图.png'), ('head', '头部特写.png'), ('voice', 'voice.mp3')]:
        dst_file = dst_dir / filename
        if dst_file.exists():
            ss['path_dict'][key] = str(dst_file)

    if not actor_id:
        return

    # 构建该 state 的元数据条目
    url_dict = ss.get('url_dict', {})
    path_dict = ss.get('path_dict', {})
    state_entry = {
        "subject_id": ss.get('element_id', ''),
        "face_view": path_dict.get('front', ''),
        "face_view_url": url_dict.get('front', ''),
        "side_view": path_dict.get('side', ''),
        "side_view_url": url_dict.get('side', ''),
        "back_view": path_dict.get('back', ''),
        "back_view_url": url_dict.get('back', ''),
        "three_view": path_dict.get('three', ''),
        "three_view_url": url_dict.get('three', ''),
        "head_closeup": path_dict.get('head', ''),
        "head_closeup_url": url_dict.get('head', ''),
    }

    # 读取现有 actors.json（增量合并，不覆盖其他角色数据）
    actors_json_path = Path(project_dir) / "actors" / "actors.json"
    actors_metadata = {}
    if actors_json_path.exists():
        try:
            with open(actors_json_path, 'r', encoding='utf-8') as f:
                actors_metadata = json.load(f)
        except Exception as e:
            log(f"  ⚠ 读取 actors.json 失败: {e}")

    # 新建或更新角色条目（仅写入当前 state，不影响已有数据）
    if actor_id not in actors_metadata:
        actors_metadata[actor_id] = {
            "name": actor_name,
            "voice": "",
            "voice_url": ""
        }
    # 从 state 更新 voice 字段（有值才写入）
    voice_path = path_dict.get('voice', '')
    voice_url = url_dict.get('voice', '')
    if voice_path:
        actors_metadata[actor_id]['voice'] = voice_path
    if voice_url:
        actors_metadata[actor_id]['voice_url'] = voice_url
    actors_metadata[actor_id][state_name] = state_entry

    # 增量写回
    actors_json_path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(actors_json_path, actors_metadata)
    log(f"  [actors.json] 已更新角色「{actor_name}」状态「{state_name}」")


# ══════════════════════════════════════════════════════════════════════════════
# 线程1：编排 + 提交（主函数）
# ══════════════════════════════════════════════════════════════════════════════

def generate_characters(chars_json, project_dir, workspace=None, scripts_dir=None, skip_voice=False, debug=False, regenerate_names=None, voice_only=False, skip_subject=False, skip_head=False):
    """3 线程架构的角色生成主入口。voice_only=True 时仅生成音色，跳过图片流程。"""
    if not workspace:
        workspace = project_dir

    # 解析需要重新生成的角色名称集合
    regenerate_set = set(s.strip() for s in regenerate_names.split(',')) if regenerate_names else set()

    try:
        setup_logging(workspace)
    except Exception as e:
        print(f"日志初始化失败: {e}", flush=True)

    # ── 读取角色数据 ──────────────────────────────────────────────────────────
    with open(chars_json, 'r', encoding='utf-8') as f:
        actors_data = json.load(f)
    project_name = actors_data.get('project', 'unknown')
    actors = actors_data.get('actors', [])

    # ══════════════════════════════════════════════════════════════════════════
    # voice_only 分支：仅生成音色，完成后返回
    # ══════════════════════════════════════════════════════════════════════════
    if voice_only:
        log(f"=== 独立音色生成模式启动 ===")
        log(f"项目: {project_name}, 角色数: {len(actors)}")

        actors_json_path = Path(project_dir) / "actors" / "actors.json"
        output_base = Path(project_dir) / "actors"
        results, errors = {}, []
        _wall_start = time.time()
        _actors_json_lock = threading.Lock()

        def _save_voice_to_json(actor_id, actor_name, state_name, voice_path, cos_url, output_path_str):
            """单条音色生成完成后立即写入 actors.json 对应 state（加锁保证并发安全）。"""
            rel_path = str(Path(output_path_str).relative_to(project_dir)).replace("\\", "/")
            with _actors_json_lock:
                meta = {}
                if actors_json_path.exists():
                    try:
                        with open(actors_json_path, 'r', encoding='utf-8') as f:
                            meta = json.load(f)
                    except Exception:
                        pass
                if actor_id not in meta:
                    meta[actor_id] = {"name": actor_name}
                if state_name not in meta[actor_id]:
                    meta[actor_id][state_name] = {}
                meta[actor_id][state_name]['voice'] = rel_path
                if cos_url:
                    meta[actor_id][state_name]['voice_url'] = cos_url
                actors_json_path.parent.mkdir(parents=True, exist_ok=True)
                _write_json(actors_json_path, meta)
            log(f"  [actors.json] 已更新角色「{actor_name}」状态「{state_name}」音色")

        def _process_actor(actor):
            """单角色音色生成：过滤 → 断点续传检查 → 复用 run_voice_generation → 写 JSON。"""
            actor_name    = actor['actor_name']
            actor_id      = actor.get('actor_id', actor_name)
            # voice_only + regenerate_set 非空时，只处理指定角色
            if regenerate_set and actor_name not in regenerate_set:
                return actor_id, None, None
            default_state = next((s for s in actor.get('states', []) if s.get('is_default')), None)
            if not default_state:
                log(f"  ⚠ 角色「{actor_name}」无默认 state，跳过")
                return actor_id, None, None
            state_name  = default_state['state_name']
            output_path = output_base / sanitize_dirname(actor_name) / sanitize_dirname(state_name) / "voice.mp3"
            # 重新生成或 voice_only 模式时删除已有文件，防止内部断点续传复用旧文件
            is_regenerate = actor_name in regenerate_set or voice_only
            if is_regenerate and output_path.exists():
                output_path.unlink()
                log(f"  [重新生成] 已删除旧音色: {actor_name}")
            voice_path, cos_url = run_voice_generation(actor, output_base)
            if voice_path:
                # 重新生成音色后，先创建主体（绑定新音色），再写入 actors.json
                if is_regenerate and cos_url:
                    log(f"  [重新创建主体] 角色「{actor_name}」音色已更新，开始重新创建主体...")
                    # 从 actors.json 读取已有的图片 URL
                    frontal_image_url = None
                    refer_urls = []
                    element_id = None
                    if actors_json_path.exists():
                        try:
                            with open(actors_json_path, 'r', encoding='utf-8') as f:
                                meta = json.load(f)
                            actor_meta = meta.get(actor_id, {})
                            state_meta = actor_meta.get(state_name, {})
                            frontal_image_url = state_meta.get('face_view_url')
                            for key in ['face_view_url', 'side_view_url', 'back_view_url']:
                                url = state_meta.get(key)
                                if url:
                                    refer_urls.append(url)
                        except Exception as e:
                            log(f"  ⚠ 读取 actors.json 获取图片 URL 失败: {e}")
                    if frontal_image_url:
                        if skip_subject:
                            log(f"  ⏭ 角色「{actor_name}」跳过创建主体（--skip-subject）")
                            element_id = None
                        else:
                            description = actor.get('description', actor_name)
                            element_id = process_actor(
                                element_name=actor_name,
                                element_description=description[:90],
                                element_frontal_image=frontal_image_url,
                                dry_run=False,
                                voice_path=cos_url,
                                element_refer_list=refer_urls if refer_urls else None,
                            )
                            if element_id:
                                log(f"  ✅ 角色主体重新创建成功: {actor_name} → {element_id}")
                            else:
                                log(f"  ❌ 角色主体重新创建失败: {actor_name}")
                    else:
                        log(f"  ⚠ 角色「{actor_name}」无正面图 URL，跳过创建主体")
                    # 主体创建完成后，写入音色和 subject_id 到 actors.json
                    _save_voice_to_json(actor_id, actor_name, state_name, voice_path, cos_url, str(output_path))
                    if element_id:
                        with _actors_json_lock:
                            try:
                                with open(actors_json_path, 'r', encoding='utf-8') as f:
                                    meta = json.load(f)
                                if actor_id in meta and state_name in meta[actor_id]:
                                    meta[actor_id][state_name]['subject_id'] = element_id
                                    _write_json(actors_json_path, meta)
                                    log(f"  [actors.json] 已更新角色「{actor_name}」主体 ID")
                            except Exception as e:
                                log(f"  ⚠ 更新 subject_id 失败: {e}")
                else:
                    _save_voice_to_json(actor_id, actor_name, state_name, voice_path, cos_url, str(output_path))
            return actor_id, voice_path, cos_url

        with ThreadPoolExecutor(max_workers=SUBMIT_WORKERS) as pool:
            future_map = {pool.submit(_process_actor, actor): actor for actor in actors}
            for future in as_completed(future_map):
                actor = future_map[future]
                try:
                    aid, voice_path, cos_url = future.result()
                    if voice_path:
                        results[aid] = {"local_path": voice_path, "cos_url": cos_url}
                    elif aid:
                        errors.append(f"{aid} 音色生成失败")
                except Exception as e:
                    actor_name = actor.get('actor_name', '')
                    errors.append(f"{actor.get('actor_id', actor_name)} 异常: {e}")
                    log(f"  ❌ 「{actor_name}」音色异常: {e}")

        _m, _s = divmod(int(time.time() - _wall_start), 60)
        log(f"\n=== 音色生成完成 ===")
        log(f"  成功: {len(results)}, 失败: {len(errors)}, 耗时: {_m:02d}:{_s:02d}")
        for e in errors:
            log(f"  ❌ {e}")
        close_logging()
        return

    # ══════════════════════════════════════════════════════════════════════════
    # 正常图片生成流程
    # ══════════════════════════════════════════════════════════════════════════
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    log(f"=== 角色生成启动 (run_id={run_id}) ===")
    log(f"架构: 3线程 + 队列 (提交{SUBMIT_WORKERS}并发, 轮询{POLL_WORKERS}并发, 审核{REVIEW_WORKERS}并发)")
    log(f"项目: {project_name}, 角色数: {len(actors)}")

    # ── 加载世界观风格 ────────────────────────────────────────────────────────
    style_data = load_project_style(workspace)

    # ── 初始化状态 ────────────────────────────────────────────────────────────
    workspace_path = Path(workspace)
    temp_dir = workspace_path / "_temp" / "actors"
    temp_dir.mkdir(parents=True, exist_ok=True)
    # 中间文件统一存放到 temp_dir，角色全部完成后再统一写入 output
    project_path = Path(project_dir)

    # 初始化角色状态和任务状态，写入 actor_state_{uuid}.json / actor_tasks_{uuid}.json
    # actor_state: {state_id: {状态、依赖、prompts完成情况}}
    # task_state:  {prompt_id: {api_task_id、图片路径、审核结果}}
    actor_state, task_state, char_path, task_path = _init_actor_state(
        actors_data, run_id, workspace
    )
    log(f"状态文件: {char_path.name}, {task_path.name}")

    # ── 检查已存在的角色（断点续传）：从 actors.json 判断是否已完成 ────────────────
    actors_json_path = project_path / "actors" / "actors.json"
    existing_metadata = {}
    if actors_json_path.exists():
        try:
            with open(actors_json_path, 'r', encoding='utf-8') as f:
                existing_metadata = json.load(f)
        except Exception as e:
            log(f"  ⚠ 读取 actors.json 失败: {e}")

    # Checkpoint asset files that indicate a fully completed state.
    # At least the three-view image must exist; side/front files from splitting are optional extras.
    _CHECKPOINT_REQUIRED = ('三视图.png',)
    _CHECKPOINT_OPTIONAL = ('正面.png', '侧面.png', '背面.png')

    for sid, ss in actor_state.items():
        actor_id = ss.get('actor_id', '')
        actor_name = ss['actor_name']
        state_name = ss['state_name']

        # Actors explicitly named in --regenerate always bypass checkpoints
        if actor_name in regenerate_set:
            log(f"  [重新生成] 角色「{actor_name}」已指定重新生成，跳过检查点")
            continue

        # --- Primary checkpoint: actors.json entry ---
        actor_entry = existing_metadata.get(actor_id, {})
        if actor_id and state_name in actor_entry:
            ss['status'] = S_DONE
            for pid in ss['prompts']:
                task_state[pid]['status'] = T_DONE
                ss['prompts'][pid] = T_DONE
            log(f"  [复用] 角色「{actor_name}」状态「{state_name}」在 actors.json 中已存在，跳过")
            continue

        # --- Secondary checkpoint: scan output directory for asset files ---
        safe_actor = sanitize_dirname(actor_name)
        safe_state = sanitize_dirname(state_name)
        actor_out_dir = project_path / "actors" / safe_actor / safe_state
        required_files_present = all((actor_out_dir / f).exists() for f in _CHECKPOINT_REQUIRED)
        if required_files_present:
            ss['status'] = S_DONE
            for pid in ss['prompts']:
                task_state[pid]['status'] = T_DONE
                ss['prompts'][pid] = T_DONE
            # Populate path_dict so downstream steps (subject creation, etc.) can find the files
            for key, filename in [('three', '三视图.png'), ('front', '正面.png'),
                                  ('side', '侧面.png'), ('back', '背面.png'), ('head', '头部特写.png')]:
                candidate = actor_out_dir / filename
                if candidate.exists():
                    ss.setdefault('path_dict', {})[key] = str(candidate)
            log(f"  [checkpoint] Skipping {actor_name}/{state_name} - assets already exist in {actor_out_dir}")

    _write_json(char_path, actor_state)
    _write_json(task_path, task_state)

    # ── 队列 & 事件 ──────────────────────────────────────────────────────────
    pending_q = queue.Queue()   # 线程1 → 线程2
    review_q = queue.Queue()    # 线程1 → 线程3
    inbox_q = queue.Queue()     # 线程2/3 → 线程1
    stop_event = threading.Event()

    # ── 启动子线程 ────────────────────────────────────────────────────────────
    t2 = threading.Thread(
        target=_poller_thread,
        args=(pending_q, inbox_q, stop_event, temp_dir),
        name="轮询线程", daemon=True,
    )
    t3 = threading.Thread(
        target=_reviewer_thread,
        args=(review_q, inbox_q, stop_event, temp_dir, style_data),
        name="审核线程", daemon=True,
    )
    t2.start()
    t3.start()
    log(f"子线程已启动: {t2.name}, {t3.name}")

    # ── 提交线程池（线程1内部）────────────────────────────────────────────────
    submit_pool = ThreadPoolExecutor(max_workers=SUBMIT_WORKERS)
    # Set to True when InsufficientCreditsError is raised; all submit workers check this flag.
    _credits_exhausted = threading.Event()

    def _do_submit(state_id, prompt_id):
        """在线程池中提交生图任务，结果统一通过 inbox_q 通知线程1。"""
        if _credits_exhausted.is_set():
            inbox_q.put({
                "type": "gen_result", "prompt_id": prompt_id,
                "state_id": state_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "积分不足，已终止提交",
            })
            return
        ss = actor_state[state_id]
        ts = task_state[prompt_id]
        _thread_local.asset_prefix = f"【{ss['actor_name']}】"
        params = {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
        tmp_prompt = ts['prompt']
        if ss.get('iref_url'):
            params["iref"] = [ss['iref_url']]
            tmp_prompt += "只参考图片的风格："+tmp_prompt

        log(f"  [提交] {ss['actor_name']} / {prompt_id[:8]} tmp_prompt: {tmp_prompt} params: {params}...")
        # submit_image_task has 3 internal retries; InsufficientCreditsError propagates immediately.
        try:
            api_task_id = submit_image_task(tmp_prompt, params)
        except InsufficientCreditsError as e:
            log(f"  ❌ 积分不足，停止所有提交: {e}")
            _credits_exhausted.set()
            inbox_q.put({
                "type": "gen_result", "prompt_id": prompt_id,
                "state_id": state_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": str(e),
            })
            return

        if api_task_id:
            # 提交成功，投入 pending_q 让线程2轮询；同时通知线程1更新状态
            now = time.time()
            pending_q.put({
                "prompt_id": prompt_id,
                "state_id": state_id,
                "actor_name": ss['actor_name'],
                "api_task_id": api_task_id,
                "created_at": now,
                "timeout": TASK_TIMEOUT,
                "check_count": 0,
                "error_count": 0,
                "next_check_at": now + 3,
                "round": ss.get('round', 1),
            })
            inbox_q.put({
                "type": "submit_result", "prompt_id": prompt_id,
                "state_id": state_id, "api_task_id": api_task_id,
                "created_at": now,
            })
        else:
            # 提交失败，通过 inbox_q 通知线程1，由线程1统一处理状态
            inbox_q.put({
                "type": "gen_result", "prompt_id": prompt_id,
                "state_id": state_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "提交失败",
            })

    def _do_submit_head_closeup(state_id, prompt_id):
        """在线程池中提交头部特写生图任务。"""
        if _credits_exhausted.is_set():
            inbox_q.put({
                "type": "head_gen_result", "prompt_id": prompt_id,
                "state_id": state_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "积分不足，已终止提交",
            })
            return
        ss = actor_state[state_id]
        ts = task_state[prompt_id]
        _thread_local.asset_prefix = f"【{ss['actor_name']}】"
        front_url = ss['url_dict'].get('front', '')
        params = {"quality": "2K", "ratio": "1:1", "generate_num": "1"}
        if front_url:
            params["iref"] = [front_url]

        log(f"  [提交头部特写] {ss['actor_name']} prompt: {ts['prompt']}, iref: {front_url}")
        try:
            api_task_id = submit_image_task(ts['prompt'], params)
        except InsufficientCreditsError as e:
            log(f"  ❌ 积分不足，停止所有提交: {e}")
            _credits_exhausted.set()
            inbox_q.put({
                "type": "head_gen_result", "prompt_id": prompt_id,
                "state_id": state_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": str(e),
            })
            return

        if api_task_id:
            now = time.time()
            pending_q.put({
                "prompt_id": prompt_id,
                "state_id": state_id,
                "actor_name": ss['actor_name'],
                "api_task_id": api_task_id,
                "created_at": now,
                "timeout": TASK_TIMEOUT,
                "check_count": 0,
                "error_count": 0,
                "next_check_at": now + 3,
                "round": ss.get('round', 1),
                "msg_type": "head_gen_result",
            })
            inbox_q.put({
                "type": "submit_result", "prompt_id": prompt_id,
                "state_id": state_id, "api_task_id": api_task_id,
                "created_at": now,
            })
        else:
            inbox_q.put({
                "type": "head_gen_result", "prompt_id": prompt_id,
                "state_id": state_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "头部特写提交失败",
            })

    # ── 提交所有默认 state 且未完成的角色 ────────────────────────────
    submitted_count = 0
    _wall_start = time.time()
    for sid, ss in actor_state.items():
        if ss['status'] != S_PENDING:
            continue
        # 只提交默认 state（is_default=True），变体 state 等默认 state 完成后再触发
        if not ss.get('is_default', False):
            continue
        ss["status"] = S_THREE_VIEW_GENERATING
        ss['start_time'] = time.time()
        ss['round'] = 1
        for pid in ss['prompts']:
            if ss['prompts'][pid] == T_PENDING:
                submit_pool.submit(_do_submit, sid, pid)
                submitted_count += 1

    log(f"\n=== 已提交 {submitted_count} 个默认 state 三视图生成任务 ===")

    _write_json(char_path, actor_state)
    # task_state 此时尚未被 _do_submit 更新（异步执行），等主循环收到 submit_result 后再写入

    # ── 辅助函数：头部审核通过后的后续流程 ────────────────────────────────────
    def _proceed_after_head_review(ss):
        """封装 voice → subject → finalize 流程，返回 should_trigger_variants"""
        if not skip_voice:
            ss['status'] = S_VOICE_GENERATING
            log(f"  [音色] 角色「{ss['actor_name']}」开始生成音色")
            char_data = next((c for c in actors_data['actors'] if c['actor_name'] == ss['actor_name']), None)
            if char_data:
                voice_path, voice_url = run_voice_generation(char_data, temp_dir)
                if voice_path:
                    ss['path_dict']['voice'] = voice_path
                if voice_url:
                    ss['url_dict']['voice'] = voice_url
                    log(f"  音色已上传到COS: {voice_url}")
            ss['status'] = S_DONE
        else:
            log(f"  [跳过] 角色「{ss['actor_name']}」跳过音色生成")
            ss['status'] = S_DONE

        if skip_subject:
            log(f"  ⏭ 角色「{ss['actor_name']}」跳过创建主体（--skip-subject）")
        else:
            log(f"  [创建主体] 角色「{ss['actor_name']}」开始创建主体...")
            _try_create_subject(ss)
        _finalize_char_to_output(ss, project_dir, temp_dir)
        if ss.get('start_time'):
            log(f"  [耗时] 角色「{ss['actor_name']}」耗时 {_fmt_elapsed(ss['start_time'])}")
        return True

    def _trigger_variants(ss, sid, best_prompt_id):
        """封装 variant 触发逻辑"""
        if best_prompt_id:
            default_show_url = task_state[best_prompt_id].get('show_url')
        else:
            first_pid = list(ss['prompts'].keys())[0]
            default_show_url = task_state[first_pid].get('show_url')
        for v_sid, v_ss in actor_state.items():
            if v_ss.get('depends_on') == sid and v_ss['status'] == S_PENDING:
                v_ss['iref_url'] = default_show_url
                v_ss['status'] = S_THREE_VIEW_GENERATING
                v_ss['start_time'] = time.time()
                v_ss['round'] = 1
                log(f"  [编排] 触发变体角色「{v_ss['actor_name']}」(iref from {ss['actor_name']})")
                for v_pid in v_ss['prompts']:
                    if v_ss['prompts'][v_pid] == T_PENDING:
                        submit_pool.submit(_do_submit, v_sid, v_pid)

    # ── 主循环：监听 inbox_q ──────────────────────────────────────────────────
    GLOBAL_TIMEOUT = 7200 * 2
    try:
        while True:
            # 检查是否全部完成
            all_done = all(ss['status'] == S_DONE for ss in actor_state.values())
            if all_done:
                break

            # 全局超时保护
            if time.time() - _wall_start > GLOBAL_TIMEOUT:
                log(f"  [超时] 全局超时 {GLOBAL_TIMEOUT}s，强制结束")
                # 不要强制将未完成的任务标记为 S_DONE
                # 保持实际状态，这样最终元数据只包含真正完成的角色
                incomplete_count = sum(1 for ss in actor_state.values() if ss['status'] != S_DONE)
                log(f"  [超时] 有 {incomplete_count} 个角色未完成，将保存已完成的角色")
                # 超时时也要保存状态，避免丢失已完成的任务
                _write_json(char_path, actor_state)
                _write_json(task_path, task_state)
                break

            try:
                msg = inbox_q.get(timeout=0.5)
                _sid = msg.get('state_id')
                if _sid and _sid in actor_state:
                    _thread_local.asset_prefix = f"【{actor_state[_sid]['actor_name']}】"
                log(f"  [主循环] 收到消息: type={msg.get('type', 'N/A')}, state_id={msg.get('state_id', 'N/A')}, prompt_id={msg.get('prompt_id', 'N/A')[:8] if msg.get('prompt_id') else 'N/A'}...msg: {msg}")
            except queue.Empty:
                continue

            # ── 处理提交结果：更新 task_state ────────────────────────────────
            if msg['type'] == 'submit_result':  # 提交生图任务结果
                pid = msg['prompt_id']
                ts = task_state[pid]
                ts['api_task_id'] = msg['api_task_id']
                ts['status'] = T_RUNNING
                ts['created_at'] = msg['created_at']
                log(f"  [已提交] {actor_state[msg['state_id']]['actor_name']} / {pid[:8]}... task_id={msg['api_task_id']}")

            # ── 处理生图结果（仅三视图）──────────────────────────────────────
            elif msg['type'] == 'gen_result':
                pid = msg['prompt_id']
                sid = msg['state_id']
                ts = task_state[pid]
                ss = actor_state[sid]

                if msg['status'] == T_DONE:
                    ts['status'] = T_DONE
                    ts['image_path'] = msg.get('image_path')
                    ts['show_url'] = msg.get('show_url')
                    ss['prompts'][pid] = T_DONE
                    log(f"  [完成] {ss['actor_name']} / {pid[:8]}... 生图成功")

                    image_path = msg.get('image_path')
                    image_url = msg.get('image_url')
                    if image_path and Path(image_path).exists():
                        ss['path_dict']['three'] = image_path
                    if image_url:
                        ss['url_dict']['three'] = image_url

                elif msg['status'] == T_FAILED:
                    ts['status'] = T_FAILED
                    ts['reject_reason'] = msg.get('reason', '')
                    ss['prompts'][pid] = T_FAILED
                    log(f"  [失败] {ss['actor_name']} / {pid[:8]}... {msg.get('reason', '')}")

                # 统一检查角色状态
                prompt_statuses = list(ss['prompts'].values())
                all_terminal = all(v in (T_DONE, T_FAILED) for v in prompt_statuses)
                if all_terminal and ss["status"] == S_THREE_VIEW_GENERATING:
                    has_success = any(v == T_DONE for v in prompt_statuses)
                    all_failed = all(v == T_FAILED for v in prompt_statuses)

                    if all_failed and ss['round'] < MAX_REVIEW_ROUNDS:
                        ss['round'] += 1
                        log(f"  [重试] 角色「{ss['actor_name']}」全部失败，第{ss['round']}轮重新生成")
                        for retry_pid in ss['prompts']:
                            task_state[retry_pid]['status'] = T_PENDING
                            ss['prompts'][retry_pid] = T_PENDING
                            submit_pool.submit(_do_submit, sid, retry_pid)
                    elif all_failed:
                        ss['status'] = S_DONE
                        if ss.get('start_time'):
                            log(f"  [耗时] 角色「{ss['actor_name']}」耗时 {_fmt_elapsed(ss['start_time'])}（全部失败）")
                        log(f"  [放弃] 角色「{ss['actor_name']}」全部失败，达到最大轮次")
                    elif has_success:
                        ss["status"] = S_THREE_VIEW_WAIT_REVIEW
                        success_prompts = [(p, task_state[p]) for p, v in ss['prompts'].items() if v == T_DONE]
                        log(f"  [编排] 角色「{ss['actor_name']}」所有prompt已有终态，投入审核队列（共{len(success_prompts)}个候选）")
                        review_q.put({
                            "state_id": sid,
                            "actor_name": ss['actor_name'],
                            "state_name": ss.get('state_name', ''),
                            "candidates": [
                                {
                                    "prompt_id": pid,
                                    "image_path": ts['image_path'],
                                    "prompt": ts['prompt'],
                                }
                                for pid, ts in success_prompts
                            ],
                            "script_context": ss.get('description', ''),
                        })

            # ── 处理头部特写生图结果 ──────────────────────────────────────────
            elif msg['type'] == 'head_gen_result':
                pid = msg['prompt_id']
                sid = msg['state_id']
                ts = task_state[pid]
                ss = actor_state[sid]

                if msg['status'] == T_DONE:
                    ts['status'] = T_DONE
                    ts['image_path'] = msg.get('image_path')
                    ts['show_url'] = msg.get('show_url')
                    log(f"  [头部特写完成] {ss['actor_name']} 生成成功")

                    image_path = msg.get('image_path')
                    # 复制到 temp 角色目录
                    if image_path and Path(image_path).exists():
                        safe_actor_name = sanitize_dirname(ss['actor_name'])
                        safe_state_name = sanitize_dirname(ss['state_name'])
                        temp_char_dir = Path(temp_dir) / safe_actor_name / safe_state_name
                        temp_char_dir.mkdir(parents=True, exist_ok=True)
                        head_dst = temp_char_dir / "头部特写.png"
                        shutil.copy2(image_path, str(head_dst))
                        ss['path_dict']['head'] = str(head_dst)

                        # 上传到COS
                        url, _ = upload_to_cos(str(head_dst), scene_type="agent-material")
                        if url:
                            ss['url_dict']['head'] = url
                            log(f"  [头部特写] 已上传COS: {url}")

                    # 投入头部特写审核
                    head_path = ss['path_dict'].get('head')
                    if head_path:
                        ss['status'] = S_HEAD_CLOSEUP_WAIT_REVIEW
                        log(f"  [编排] 角色「{ss['actor_name']}」头部特写生成完成，投入审核")
                        review_q.put({
                            "state_id": sid,
                            "actor_name": ss['actor_name'],
                            "state_name": ss.get('state_name', ''),
                            "review_type": "head_closeup",
                            "head_closeup_path": head_path,
                            "front_image_path": ss['path_dict'].get('front', ''),
                        })
                    else:
                        log(f"  [跳过] 角色「{ss['actor_name']}」头部特写保存失败，跳过审核")
                        should_trigger = _proceed_after_head_review(ss)
                        if should_trigger:
                            _trigger_variants(ss, sid, ss.get('main_task_id'))

                elif msg['status'] == T_FAILED:
                    ts['status'] = T_FAILED
                    log(f"  [头部特写失败] {ss['actor_name']}: {msg.get('reason', '')}, 跳过头部特写")
                    # 生成失败，跳过头部特写，直接走后续流程
                    should_trigger = _proceed_after_head_review(ss)
                    if should_trigger:
                        _trigger_variants(ss, sid, ss.get('main_task_id'))

            elif msg['type'] == 'review_result':
                sid = msg['state_id']
                ss = actor_state[sid]
                should_trigger_variants = False
                best_prompt_id = msg.get('best_prompt_id')
                candidate_scores = msg.get('candidate_scores', {})

                # 将所有候选的评分和驳回原因写入task_state（保留历史）
                current_round = ss['round']
                for prompt_id, score_info in candidate_scores.items():
                    if prompt_id in task_state:
                        ts = task_state[prompt_id]
                        # 初始化review_history数组（如果不存在）
                        if 'review_history' not in ts:
                            ts['review_history'] = []
                        # 将本轮评分追加到历史记录
                        ts['review_history'].append({
                            'round': current_round,
                            'score': score_info,
                            'timestamp': time.time(),
                        })
                        # 同时更新当前的score和reject_reason（最新一轮）
                        ts['score'] = score_info
                        if score_info.get('reject_reason'):
                            ts['reject_reason'] = score_info['reject_reason']
                        log(f"  [评分] prompt {prompt_id[:8]}... 第{current_round}轮 总分: {score_info.get('total', 0):.2f}{' - ' + score_info.get('reject_reason', '') if score_info.get('reject_reason') else ''}")

                if msg['approved'] and best_prompt_id:
                    log(f"  [通过] 角色「{ss['actor_name']}」三视图审核通过（最佳候选评分: {msg.get('best_score', 0):.2f}）")
                    ss['main_task_id'] = best_prompt_id
                    # 暂存三视图到 temp 目录（不直接写入 output）
                    dst, temp_char_dir = _stage_char_images_single(ss, task_state[best_prompt_id], temp_dir)

                    # 只对第一个（最佳）三视图进行切分，切分结果也存入 temp
                    if dst and temp_char_dir:
                        split_result = split_three_view_image(str(dst), str(temp_char_dir))

                        # 填充 path_dict（temp 路径）和 url_dict
                        if split_result and split_result.get('front'):
                            log(f"  角色「{ss['actor_name']}」三视图已切分并上传完成")
                            for key in ['front', 'back', 'side']:
                                split_path = split_result.get(key)
                                if split_path:
                                    ss['path_dict'][key] = split_path
                                url = split_result.get(f'{key}_url')
                                if url:
                                    ss['url_dict'][key] = url


                    # 提交头部特写生成任务
                    if skip_head:
                        log(f"  ⏭ 角色「{ss['actor_name']}」跳过头部特写生成（--skip-head）")
                        should_trigger_variants = _proceed_after_head_review(ss)
                    else:
                        front_url = ss['url_dict'].get('front')
                        if front_url:
                            head_pid = f"head_{uuid.uuid4().hex[:8]}"
                            ss['head_prompt_id'] = head_pid
                            head_prompt = _GC["prompt_templates"]["head_closeup"]
                            task_state[head_pid] = {
                                "prompt_id": head_pid,
                                "state_id": sid,
                                "actor_id": ss.get('actor_id', ''),
                                "prompt": head_prompt,
                                "api_task_id": None,
                                "status": T_PENDING,
                                "image_path": None,
                                "show_url": None,
                                "score": None,
                                "reject_reason": None,
                                "created_at": None,
                                "timeout": TASK_TIMEOUT,
                            }
                            ss['status'] = S_HEAD_CLOSEUP_GENERATING
                            log(f"  [编排] 角色「{ss['actor_name']}」三视图通过，提交头部特写生成")
                            submit_pool.submit(_do_submit_head_closeup, sid, head_pid)
                        else:
                            # 无正面图URL，跳过头部特写，直接走后续流程
                            log(f"  [跳过] 角色「{ss['actor_name']}」无正面图URL，跳过头部特写生成")
                            should_trigger_variants = _proceed_after_head_review(ss)
                else:
                    reason = msg.get('reason', '')
                    log(f"  [驳回] 角色「{ss['actor_name']}」审核不通过: {reason[:60]}")
                    if ss['round'] < MAX_REVIEW_ROUNDS:
                        ss['round'] += 1
                        ss['status'] = S_THREE_VIEW_GENERATING
                        # 重写 prompt 并重新提交所有 prompt
                        for pid in ss['prompts']:
                            ts = task_state[pid]
                            # 保留原始prompt到历史记录
                            if 'prompt_history' not in ts:
                                ts['prompt_history'] = []
                            ts['prompt_history'].append({
                                'round': ss['round'] - 1,
                                'prompt': ts['prompt'],
                                'retry_reason': reason,
                            })
                            # 重写prompt
                            ts['prompt'] = build_retry_prompt(ts['prompt'], reason)
                            ts['status'] = T_PENDING
                            # 更新当前reject_reason（不覆盖历史）
                            ts['reject_reason'] = f"[第{ss['round']-1}轮] {reason}"
                            ss['prompts'][pid] = T_PENDING
                            submit_pool.submit(_do_submit, sid, pid)
                        log(f"  [重试] 角色「{ss['actor_name']}」第{ss['round']}轮重新生成")
                    else:
                        # 兜底策略：达到最大轮次，使用评分最高的候选
                        log(f"  [兜底] 角色「{ss['actor_name']}」达到最大审核轮次，使用评分最高的候选")
                        if best_prompt_id:
                            ss['main_task_id'] = best_prompt_id
                            log(f"  [兜底] 使用评分最高的候选 (评分: {msg.get('best_score', 0):.2f})")
                        else:
                            import random
                            success_pids = [p for p, v in ss['prompts'].items() if v == T_DONE]
                            if success_pids:
                                ss['main_task_id'] = random.choice(success_pids)
                                log(f"  [兜底] 随机选择一个候选")

                        # 暂存图片到 temp 目录
                        if ss.get('main_task_id'):
                            dst, temp_char_dir = _stage_char_images_single(ss, task_state[ss['main_task_id']], temp_dir)

                            # 切分三视图（也存到 temp）
                            if dst and temp_char_dir:
                                split_result = split_three_view_image(str(dst), str(temp_char_dir))
                                if split_result and split_result.get('front'):
                                    log(f"  角色「{ss['actor_name']}」三视图已切分并上传完成")
                                    for key in ['front', 'back', 'side']:
                                        split_path = split_result.get(key)
                                        if split_path:
                                            ss['path_dict'][key] = split_path
                                        url = split_result.get(f'{key}_url')
                                        if url:
                                            ss['url_dict'][key] = url


                            should_trigger_variants = _proceed_after_head_review(ss)

                        ss['status'] = S_DONE
                        if ss.get('start_time'):
                            log(f"  [耗时] 角色「{ss['actor_name']}」耗时 {_fmt_elapsed(ss['start_time'])}（兜底）")
                        log(f"  [兜底完成] 角色「{ss['actor_name']}」已保存（审核未通过但已达最大轮次）")

                # 统一触发依赖此角色的 variant 角色
                if should_trigger_variants:
                    _trigger_variants(ss, sid, best_prompt_id)

            # ── 处理头部特写审核结果 ──────────────────────────────────────────
            elif msg['type'] == 'head_review_result':
                sid = msg['state_id']
                ss = actor_state[sid]
                should_trigger_variants = False
                best_prompt_id = ss.get('main_task_id')

                if msg.get('approved', True):
                    # 头部特写审核通过 → 继续后续流程
                    log(f"  [通过] 角色「{ss['actor_name']}」头部特写审核通过")
                    should_trigger_variants = _proceed_after_head_review(ss)
                elif ss['round'] < MAX_REVIEW_ROUNDS:
                    # 头部审核驳回 + 还有重试机会 → 重新生成头部特写
                    reason = msg.get('reason', '头部特写质量不佳')
                    ss['round'] += 1
                    log(f"  [驳回] 角色「{ss['actor_name']}」头部特写审核不通过: {reason[:60]}")
                    head_pid = f"head_{uuid.uuid4().hex[:8]}"
                    ss['head_prompt_id'] = head_pid
                    head_prompt = _GC["prompt_templates"]["head_closeup"]
                    task_state[head_pid] = {
                        "prompt_id": head_pid,
                        "state_id": sid,
                        "actor_id": ss.get('actor_id', ''),
                        "prompt": head_prompt,
                        "api_task_id": None,
                        "status": T_PENDING,
                        "image_path": None,
                        "show_url": None,
                        "score": None,
                        "reject_reason": None,
                        "created_at": None,
                        "timeout": TASK_TIMEOUT,
                    }
                    ss['status'] = S_HEAD_CLOSEUP_GENERATING
                    submit_pool.submit(_do_submit_head_closeup, sid, head_pid)
                    log(f"  [重试] 角色「{ss['actor_name']}」第{ss['round']}轮重新生成头部特写")
                else:
                    # 兜底：达到最大轮次，使用当前结果
                    log(f"  [兜底] 角色「{ss['actor_name']}」头部特写审核不通过但已达最大轮次，使用当前结果")
                    should_trigger_variants = _proceed_after_head_review(ss)

                if should_trigger_variants:
                    _trigger_variants(ss, sid, best_prompt_id)

            # 每次处理消息后更新状态文件
            _write_json(char_path, actor_state)
            _write_json(task_path, task_state)

    except KeyboardInterrupt:
        log("用户中断")
    except Exception as e:
        log(f"编排异常: {e}")
        import traceback
        log(traceback.format_exc())
    finally:
        stop_event.set()
        submit_pool.shutdown(wait=False)

    # ── 汇总 ─────────────────────────────────────────────────────────────────
    _wall_end = time.time()
    total = len(actor_state)
    done = sum(1 for ss in actor_state.values() if ss['status'] == S_DONE)
    _m, _s = divmod(int(_wall_end - _wall_start), 60)

    log(f"\n=== 角色生成完成 ===")
    log(f"  总计: {total}, 完成: {done}, 耗时: {_m:02d}:{_s:02d}")
    log(f"  输出: {project_dir}/actors/")
    log(f"  状态: {char_path}")

    # ── 生成角色元数据 JSON（已在每个角色完成时通过 _finalize_char_to_output 增量更新）──
    actors_json_path = Path(project_dir) / "actors" / "actors.json"
    if actors_json_path.exists():
        log(f"  元数据: {actors_json_path}（增量更新）")

    if temp_dir.exists() and not debug:
        shutil.rmtree(str(temp_dir), ignore_errors=True)
    close_logging()


# ══════════════════════════════════════════════════════════════════════════════
# CLI 入口
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="角色图片自动生成（3线程架构）")
    parser.add_argument("--actors-json", required=True, help="角色 JSON 文件路径")
    parser.add_argument("--project-dir", required=True, help="项目输出目录")
    parser.add_argument("--workspace", default=None, help="工作区目录")
    parser.add_argument("--scripts-dir", default=None, help="剧本目录")
    parser.add_argument("--characters", action="store_true", help="生成角色图片（含三视图）")
    parser.add_argument("--voice", action="store_true", help="生成角色音色")
    parser.add_argument("--debug", action="store_true", help="调试模式，保留 _temp 临时文件")
    parser.add_argument("--regenerate", default=None, help="指定重新生成的角色名称，逗号分隔，如 \"李明,王芳\"")
    parser.add_argument("--skip-subject", action="store_true", default=False, help="跳过创建主体（默认不跳过）")
    parser.add_argument("--skip-head", action="store_true", default=False, help="跳过头部特写生成（默认不跳过）")
    args = parser.parse_args()
    # 从正向标志推导 skip_voice / voice_only
    if args.characters or args.voice:
        voice_only = args.voice and not args.characters
        skip_voice = not args.voice
    else:
        voice_only = False
        skip_voice = False
    generate_characters(args.actors_json, args.project_dir, args.workspace, args.scripts_dir, skip_voice, args.debug, args.regenerate, voice_only, args.skip_subject, args.skip_head)