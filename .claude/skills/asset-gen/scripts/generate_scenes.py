#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
场景图片全自动生成脚本 —— 3 线程 + 队列架构

线程模型：
  线程1(编排+提交): 解析JSON → 建依赖 → 线程池提交生图 → 监听inbox_q → 写JSON
  线程2(轮询):      监听pending_q → check_task_once → 重入队列 → 完成后投inbox_q
  线程3(审核):      监听review_q → subprocess审核 → 结果投inbox_q

队列：
  pending_q : 线程1 → 线程2  (已提交的api_task_id)
  review_q  : 线程1 → 线程3  (待审核的场景)
  inbox_q   : 线程2/3 → 线程1 (生图结果 + 审核结果)

JSON状态文件（仅线程1写入）：
  scenes_{uuid}.json : 场景状态
  tasks_{uuid}.json  : 任务状态

用法:
  python generate_scenes.py \\
    --scenes-json "path/to/scenes.json" \\
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

from common_image_api import submit_image_task, check_task_once, download_image
from common_gemini_client import rewrite_prompt
from common_create_subjects import process_actor

# ── 加载配置 ──────────────────────────────────────────────────────────────────
from common_config import get_review_config, get_config
_RC = get_review_config()
_GC = get_config()

# ── 常量 ──────────────────────────────────────────────────────────────────────
SCENE_REVIEW_SCRIPT = Path(__file__).parent / "review_scene.py"
MAX_REVIEW_ROUNDS = _RC["review_rounds"]["scene"].get("max_ref_review_rounds", 4)
POLL_INTERVAL = 5          # 轮询间隔（秒）
TASK_TIMEOUT = 600         # 单任务超时（秒）
SUBMIT_WORKERS = 10        # 提交线程池大小
POLL_WORKERS = 2           # 轮询线程池大小
REVIEW_WORKERS = 10         # 审核线程池大小

# ── 场景/任务状态常量 ─────────────────────────────────────────────────────────
S_PENDING = "未生成"
S_MAIN_GENERATING = "主图进行中"
S_MAIN_WAIT_REVIEW = "主图待审核"
S_MAIN_REVIEWING = "主图审核中"
S_REF_GENERATING = "参考图进行中"
S_REF_WAIT_REVIEW = "参考图待审核"
S_REF_REVIEWING = "参考图审核中"
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
    log_file_path = logs_dir / f"scene_gen_{timestamp}.log"
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
    elapsed = time.time() - start_time
    if elapsed < 60:
        return f"{elapsed:.1f}s"
    return f"{elapsed/60:.1f}min"


# ── 审核子进程调用 ────────────────────────────────────────────────────────────
def _call_review_subprocess(config, mode, timeout=300):
    try:
        env = {**os.environ, "PYTHONUTF8": "1"}
        config_json = json.dumps(config, ensure_ascii=False)
        result = subprocess.run(
            [sys.executable, str(SCENE_REVIEW_SCRIPT), "--config", config_json, "--mode", mode],
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
        log(f"  审图脚本异常或无法解析，默认通过")
        return {"approved": True, "summary": "默认通过", "issues": []}
    except Exception as e:
        log(f"  审图调用异常: {e}")
        return {"approved": True, "summary": "默认通过", "issues": []}


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


def _init_scene_state(scenes_data, run_id, workspace):
    """从 scenes_gen.json 构建场景状态 + 任务状态，写入 workspace。"""
    scenes = scenes_data['scenes']

    # 按 group 分组，识别 default / variant 依赖
    from collections import defaultdict
    groups = defaultdict(list)
    for s in scenes:
        groups[s.get('group', s['name'])].append(s)

    scene_state = {}   # scene_id → {...}
    task_state = {}    # prompt_id → {...}

    for group_name, members in groups.items():
        # 取组内 group_default=True 的场景作为默认场景；字段缺失时视为 True；兜底取第一个
        default_scene = next((s for s in members if s.get('group_default', True)), members[0])
        for s in members:
            is_default = (s['id'] == default_scene['id'])
            # 默认场景无依赖；变体场景依赖默认场景的生图结果(iref_url)
            depends_on = None if is_default else default_scene['id']
            scene_state[s['id']] = {
                "scene_id": s['id'],
                "name": s['name'],
                "group": group_name,
                "group_default": is_default,
                "depends_on": depends_on,
                "iref_url": None,
                "status": S_PENDING,  # 场景状态流转: 未生成→进行中→待审核→审核中→已生成
                "round": 0,
                "description": s.get('description', ''),
                "episodes": s.get('episodes', []),
                # 该场景下每个prompt的完成状态 {prompt_id: 任务状态}，用于判断场景是否全部完成
                "prompts": {p['prompt_id']: T_PENDING for p in s['scene_prompts']},
                "main_task_id": s['scene_prompts'][0]['prompt_id'],
                "ref_task_id": None,
                "ref_path": None,
                "ref_show_url": None,
                "element_id": None,
            }
            for p in s['scene_prompts']:
                task_state[p['prompt_id']] = {
                    "prompt_id": p['prompt_id'],
                    "scene_id": s['id'],
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

    scene_path = Path(workspace) / f"scene_state_{run_id}.json"
    task_path = Path(workspace) / f"scene_tasks_{run_id}.json"
    _write_json(scene_path, scene_state)
    _write_json(task_path, task_state)
    return scene_state, task_state, scene_path, task_path


# ══════════════════════════════════════════════════════════════════════════════
# 线程2：轮询线程
# ══════════════════════════════════════════════════════════════════════════════

def _poller_thread(pending_q, inbox_q, stop_event, temp_dir):
    """监听 pending_q，非阻塞轮询 API 状态，完成后投 inbox_q。"""
    log("[线程2-轮询] 启动")

    def _check_once(ticket):
        _thread_local.asset_prefix = f"【{ticket.get('scene_name', '')}】"
        now = time.time()
        # 未到下次查询时间，直接丢回
        if now < ticket.get('next_check_at', 0):
            pending_q.put(ticket)
            return
        # 超时检查
        if now - ticket.get('created_at', now) > ticket.get('timeout', TASK_TIMEOUT):
            log(f"  [轮询] {ticket['prompt_id'][:8]}... 超时")
            inbox_q.put({
                "type": "gen_result", "prompt_id": ticket['prompt_id'],
                "scene_id": ticket['scene_id'], "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "超时",
                "is_ref": ticket.get("is_ref", False),
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
                dst = Path(temp_dir) / sanitize_dirname(ticket.get('scene_name', '')) / f"{ticket['prompt_id']}_r{ticket.get('round', 1)}.png"
                img_path = download_image(result_urls[0], dst)
            show_url = display_urls[0] if display_urls else (result_urls[0] if result_urls else None)
            inbox_q.put({
                "type": "gen_result", "prompt_id": ticket['prompt_id'],
                "scene_id": ticket['scene_id'], "status": T_DONE,
                "image_path": img_path, "show_url": show_url, "reason": "",
                "is_ref": ticket.get("is_ref", False),
            })
        elif api_status in ('FAIL', 'FAILED'):
            log(f"  [轮询] {ticket['prompt_id'][:8]}... 生成失败: {resp.get('error_msg', '')}")
            inbox_q.put({
                "type": "gen_result", "prompt_id": ticket['prompt_id'],
                "scene_id": ticket['scene_id'], "status": T_FAILED,
                "image_path": None, "show_url": None,
                "reason": resp.get('error_msg', '生成失败'),
                "is_ref": ticket.get("is_ref", False),
            })
        elif api_status == 'ERROR':
            # API 请求本身出错，增加重试计数
            ticket['error_count'] = ticket.get('error_count', 0) + 1
            if ticket['error_count'] >= 10:
                inbox_q.put({
                    "type": "gen_result", "prompt_id": ticket['prompt_id'],
                    "scene_id": ticket['scene_id'], "status": T_FAILED,
                    "image_path": None, "show_url": None, "reason": "连续查询错误",
                    "is_ref": ticket.get("is_ref", False),
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
        scene_id = ticket['scene_id']
        scene_name = ticket['scene_name']
        scene_description = ticket.get('scene_description', '')
        _thread_local.asset_prefix = f"【{scene_name}】"
        candidates = ticket.get('candidates', [])

        # 兼容旧格式（单个图片）
        if not candidates and 'image_path' in ticket:
            candidates = [{
                "prompt_id": "legacy",
                "image_path": ticket['image_path'],
                "prompt": ticket['prompt'],
            }]

        tag = f"{sanitize_dirname(scene_name)}_{time.time_ns()}"

        # 构建审核配置，包含所有候选图片
        config = {
            "scenes": [
                {
                    "name": cand['prompt_id'],  # 直接用 prompt_id 作为唯一标识
                    "image": cand['image_path'],
                    "prompt": cand['prompt'],
                    "description": scene_description,
                    "is_reused": False,
                    "script_context": ticket.get('script_context', ''),
                }
                for i, cand in enumerate(candidates)
            ]
        }
        if style_data:
            config["worldview_type"] = style_data.get('worldview_type', '通用')
            config["anti_contamination"] = style_data.get('anti_contamination', '')
            config["style_note"] = style_data.get('style_source', '')

        log(f"  [审核] 场景「{scene_name}」开始审核（共{len(candidates)}个候选）...")
        rv = _call_review_subprocess(config, "main")
        log(f"  [审核] 场景「{scene_name}」审核结果 {rv}...")
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

        log(f"  [审核结果] 场景「{scene_name}」最佳候选评分: {best_score:.2f}, {'通过' if approved else '未通过'}")

        inbox_q.put({
            "type": "review_result", "scene_id": scene_id,
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
                log(f"  [审核队列] 收到审核任务: scene_id={ticket.get('scene_id', 'N/A')}, scene_name={ticket.get('scene_name', 'N/A')}, ticket: {ticket}")
                pool.submit(_do_review, ticket)
            except queue.Empty:
                continue
    log("[线程3-审核] 退出")


# ══════════════════════════════════════════════════════════════════════════════
# 保存场景图片到项目目录
# ══════════════════════════════════════════════════════════════════════════════

# def _save_scene_images(scene_id, scene_state, task_state, project_dir):
#     """将已完成场景的图片复制到 project_dir/locations/{场景名}/"""
#     ss = scene_state[scene_id]
#     safe_name = sanitize_dirname(ss['name'])
#     scene_dir = Path(project_dir) / "locations" / safe_name
#     scene_dir.mkdir(parents=True, exist_ok=True)
#
#     prompt_ids = list(ss['prompts'].keys())
#     for idx, pid in enumerate(prompt_ids):
#         ts = task_state[pid]
#         if ts.get('image_path') and Path(ts['image_path']).exists():
#             suffix = "" if idx == 0 else f"_{idx + 1}"
#             dst = scene_dir / f"主图{suffix}.png"
#             if not dst.exists():
#                 shutil.copy2(ts['image_path'], str(dst))
#                 log(f"  场景「{ss['name']}」→ locations/{safe_name}/主图{suffix}.png")


def _stage_scene_images_single(ss, ts, temp_dir):
    """将最佳候选主图暂存到 temp 目录（场景全部完成后再统一复制到输出目录）

    Args:
        ss: scene_state[scene_id] 场景状态对象
        ts: task_state[best_prompt_id] 任务状态对象
        temp_dir: 暂存根目录
    """
    safe_name = sanitize_dirname(ss['name'])
    stage_dir = Path(temp_dir) / safe_name
    stage_dir.mkdir(parents=True, exist_ok=True)

    if ts.get('image_path') and Path(ts['image_path']).exists():
        dst = stage_dir / "主图.png"
        shutil.copy2(ts['image_path'], str(dst))
        log(f"  场景「{ss['name']}」→ temp/{safe_name}/主图.png（最佳候选）")

    # 暂存参考图
    if ss.get('ref_path') and Path(ss['ref_path']).exists():
        dst = stage_dir / "特写附图.png"
        shutil.copy2(ss['ref_path'], str(dst))
        log(f"  场景「{ss['name']}」→ temp/{safe_name}/特写附图.png")

    return stage_dir


def _finalize_scene_to_output(ss, project_dir, temp_dir):
    """将单个场景的所有暂存文件从 temp 复制到最终输出目录，并增量更新 locations.json

    Args:
        ss: scene_state[scene_id] 场景状态对象
        project_dir: 项目输出目录
        temp_dir: 暂存根目录
    """
    safe_name = sanitize_dirname(ss['name'])
    src_dir = Path(temp_dir) / safe_name
    dst_dir = Path(project_dir) / "locations" / safe_name
    dst_dir.mkdir(parents=True, exist_ok=True)

    # 只复制最终文件到输出目录（跳过轮询下载的临时候选图片）
    _FINAL_FILES = ('主图.png', '特写附图.png')
    if src_dir.exists():
        for name in _FINAL_FILES:
            f = src_dir / name
            if f.exists():
                dst_file = dst_dir / name
                shutil.copy2(str(f), str(dst_file))
                log(f"  [输出] 场景「{ss['name']}」→ locations/{safe_name}/{name}")

    # 构建该场景的元数据条目
    scene_id = ss.get('scene_id', '')
    if not scene_id:
        return

    main_file = dst_dir / "主图.png"
    main_path = f"locations/{safe_name}/主图.png" if main_file.exists() else ""
    main_url = ss.get('_main_show_url', '')

    auxiliary_path = ""
    auxiliary_url = ""
    ref_file = dst_dir / "特写附图.png"
    if ref_file.exists():
        auxiliary_path = f"locations/{safe_name}/特写附图.png"
        auxiliary_url = ss.get('ref_show_url', '')

    entry = {
        "name": ss['name'],
        "subject_id": ss.get('element_id', ''),
        "main": main_path,
        "main_url": main_url,
        "auxiliary": auxiliary_path,
        "auxiliary_url": auxiliary_url,
    }

    # 读取现有 locations.json（增量合并）
    locations_json_path = Path(project_dir) / "locations" / "locations.json"
    locations_metadata = {}
    if locations_json_path.exists():
        try:
            with open(locations_json_path, 'r', encoding='utf-8') as f:
                locations_metadata = json.load(f)
        except Exception as e:
            log(f"  ⚠ 读取 locations.json 失败: {e}")

    locations_metadata[scene_id] = entry
    locations_json_path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(locations_json_path, locations_metadata)
    log(f"  [locations.json] 已更新场景「{ss['name']}」")



# ══════════════════════════════════════════════════════════════════════════════
# 线程1：编排 + 提交（主函数）
# ══════════════════════════════════════════════════════════════════════════════

def generate_scenes(scenes_json, project_dir, workspace=None, scripts_dir=None, debug=False, skip_ref=False, regenerate_names=None, skip_subject=False):
    """3 线程架构的场景生成主入口。"""
    if not workspace:
        workspace = project_dir

    # 解析需要重新生成的场景名称集合
    regenerate_set = set(s.strip() for s in regenerate_names.split(',')) if regenerate_names else set()

    try:
        setup_logging(workspace)
    except Exception as e:
        print(f"日志初始化失败: {e}", flush=True)

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    log(f"=== 场景生成启动 (run_id={run_id}) ===")
    log(f"架构: 3线程 + 队列 (提交{SUBMIT_WORKERS}并发, 轮询{POLL_WORKERS}并发, 审核{REVIEW_WORKERS}并发)")

    # ── 读取场景数据 ──────────────────────────────────────────────────────────
    with open(scenes_json, 'r', encoding='utf-8') as f:
        scenes_data = json.load(f)
    project_name = scenes_data.get('project', 'unknown')
    log(f"项目: {project_name}, 场景数: {len(scenes_data['scenes'])}")

    # ── 加载世界观风格 ────────────────────────────────────────────────────────
    style_data = load_project_style(workspace)

    # ── 初始化状态 ────────────────────────────────────────────────────────────
    workspace_path = Path(workspace)
    temp_dir = workspace_path / "_temp" / "scenes"
    temp_dir.mkdir(parents=True, exist_ok=True)
    project_path = Path(project_dir)

    # 初始化场景状态和任务状态
    scene_state, task_state, scene_path, task_path = _init_scene_state(
        scenes_data, run_id, workspace
    )
    log(f"状态文件: {scene_path.name}, {task_path.name}")

    # ── 检查已存在的场景（断点续传）：从 locations.json 判断是否已完成 ────────────
    locations_json_path = project_path / "locations" / "locations.json"
    existing_metadata = {}
    if locations_json_path.exists():
        try:
            with open(locations_json_path, 'r', encoding='utf-8') as f:
                existing_metadata = json.load(f)
        except Exception as e:
            log(f"  ⚠ 读取 locations.json 失败: {e}")

    for sid, ss in scene_state.items():
        # 指定重新生成的场景跳过断点续传
        if ss['name'] in regenerate_set:
            log(f"  [重新生成] 场景「{ss['name']}」已指定重新生成，跳过检查点")
            continue
        if sid in existing_metadata:
            ss['status'] = S_DONE
            for pid in ss['prompts']:
                task_state[pid]['status'] = T_DONE
                ss['prompts'][pid] = T_DONE
            log(f"  [复用] 场景「{ss['name']}」在 locations.json 中已存在，跳过")

    _write_json(scene_path, scene_state)
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

    def _do_submit(scene_id, prompt_id):
        """在线程池中提交生图任务，结果统一通过 inbox_q 通知线程1。"""
        ss = scene_state[scene_id]
        ts = task_state[prompt_id]
        _thread_local.asset_prefix = f"【{ss['name']}】"
        params = {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
        tmp_prompt = ts['prompt']
        if ss.get('iref_url'):
            params["iref"] = [ss['iref_url']]
            tmp_prompt += "只参考图片的风格："+tmp_prompt

        log(f"  [提交] {ss['name']} / {prompt_id[:8]} tmp_prompt: {tmp_prompt} params: {params}...")
        # submit_image_task 内部已有3次重试机制，此处无需额外重试
        api_task_id = submit_image_task(tmp_prompt, params)

        if api_task_id:
            # 提交成功，投入 pending_q 让线程2轮询；同时通知线程1更新状态
            now = time.time()
            pending_q.put({
                "prompt_id": prompt_id,
                "scene_id": scene_id,
                "scene_name": ss['name'],
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
                "scene_id": scene_id, "api_task_id": api_task_id,
                "created_at": now,
            })
        else:
            # 提交失败，通过 inbox_q 通知线程1，由线程1统一处理状态
            inbox_q.put({
                "type": "gen_result", "prompt_id": prompt_id,
                "scene_id": scene_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "提交失败",
            })

    # ── 提交所有 group_default=true 且未完成的场景 ────────────────────────────
    _wall_start = time.time()
    submitted_count = 0
    for sid, ss in scene_state.items():
        if ss['status'] != S_PENDING:
            continue
        if not ss['group_default']:
            continue
        ss["status"] = S_MAIN_GENERATING
        ss['start_time'] = time.time()
        ss['round'] = 1
        for pid in ss['prompts']:
            if ss['prompts'][pid] == T_PENDING:
                submit_pool.submit(_do_submit, sid, pid)
                submitted_count += 1

    # ── 触发依赖场景已完成的变体场景（断点续传场景）────────────────────────────
    variant_count = 0
    for sid, ss in scene_state.items():
        if ss['status'] != S_PENDING or ss['group_default']:
            continue
        dep_sid = ss.get('depends_on')
        if dep_sid and scene_state.get(dep_sid, {}).get('status') == S_DONE:
            # 从 locations.json 中获取默认场景的 main_url 作为 iref
            dep_meta = existing_metadata.get(dep_sid, {})
            iref_url = dep_meta.get('main_url', '')
            if iref_url:
                ss['iref_url'] = iref_url
                ss['status'] = S_MAIN_GENERATING
                ss['start_time'] = time.time()
                ss['round'] = 1
                log(f"  [断点续传] 触发变体场景「{ss['name']}」(iref from 已完成的「{scene_state[dep_sid]['name']}」)")
                for pid in ss['prompts']:
                    if ss['prompts'][pid] == T_PENDING:
                        submit_pool.submit(_do_submit, sid, pid)
                        submitted_count += 1
                variant_count += 1
            else:
                log(f"  ⚠ 变体场景「{ss['name']}」的依赖场景「{scene_state[dep_sid]['name']}」已完成但无 main_url，跳过")

    _write_json(scene_path, scene_state)
    # task_state 此时尚未被 _do_submit 更新（异步执行），等主循环收到 submit_result 后再写入
    # _write_json(task_path, task_state)
    log(f"\n=== 已提交 {submitted_count} 个默认场景生图任务{f'（含 {variant_count} 个断点续传变体场景）' if variant_count else ''} ===")

    # ── 主循环：监听 inbox_q ──────────────────────────────────────────────────
    GLOBAL_TIMEOUT = 3600
    try:
        while True:
            # 检查是否全部完成
            all_done = all(ss['status'] == S_DONE for ss in scene_state.values())
            if all_done:
                break

            # 全局超时保护
            if time.time() - _wall_start > GLOBAL_TIMEOUT:
                log(f"  [超时] 全局超时 {GLOBAL_TIMEOUT}s，强制结束")
                # 不要强制将未完成的任务标记为 S_DONE
                # 保持实际状态，这样最终元数据只包含真正完成的场景
                incomplete_count = sum(1 for ss in scene_state.values() if ss['status'] != S_DONE)
                log(f"  [超时] 有 {incomplete_count} 个场景未完成，将保存已完成的场景")
                # 超时时也要保存状态，避免丢失已完成的任务
                _write_json(scene_path, scene_state)
                _write_json(task_path, task_state)
                break

            try:
                msg = inbox_q.get(timeout=0.5)
                _sid = msg.get('scene_id')
                if _sid and _sid in scene_state:
                    _thread_local.asset_prefix = f"【{scene_state[_sid]['name']}】"
                log(f"  [主循环] 收到消息: type={msg.get('type', 'N/A')}, scene_id={msg.get('scene_id', 'N/A')}, prompt_id={msg.get('prompt_id', 'N/A')[:8] if msg.get('prompt_id') else 'N/A'}...msg: {msg}")
            except queue.Empty:
                continue

            # ── 处理提交结果：更新 task_state ────────────────────────────────
            if msg['type'] == 'submit_result':  # 提交生图任务结果
                pid = msg['prompt_id']
                ts = task_state[pid]
                ts['api_task_id'] = msg['api_task_id']
                ts['status'] = T_RUNNING
                ts['created_at'] = msg['created_at']
                log(f"  [已提交] {scene_state[msg['scene_id']]['name']} / {pid[:8]}... task_id={msg['api_task_id']}")

            # ── 处理生图结果 ──────────────────────────────────────────────────
            elif msg['type'] == 'gen_result':
                pid = msg['prompt_id']
                sid = msg['scene_id']
                is_ref = msg.get('is_ref', False)

                # 处理参考图生成结果
                if is_ref:
                    ss = scene_state[sid]
                    if msg['status'] == T_DONE:
                        ss['ref_path'] = msg.get('image_path')
                        ss['ref_show_url'] = msg.get('show_url')
                        log(f"  [参考图完成] 场景「{ss['name']}」参考图生成成功")

                        # 暂存到 temp 目录
                        best_prompt_id = ss.get('main_task_id')
                        ss['_main_show_url'] = task_state[best_prompt_id].get('show_url', '') if best_prompt_id else ''
                        _stage_scene_images_single(ss, task_state[best_prompt_id], temp_dir)
                        # if ss.get('ref_path'):
                        #     safe_name = sanitize_dirname(ss['name'])
                        #     scene_dir = Path(project_dir) / "locations" / safe_name
                        #     ref_dst = scene_dir / "特写附图.png"
                        #     if Path(ss['ref_path']).exists():
                        #         shutil.copy2(ss['ref_path'], str(ref_dst))
                        #         log(f"  场景「{ss['name']}」→ locations/{safe_name}/特写附图.png")

                        # 创建主体
                        log(f"  [创建主体] 场景「{ss['name']}」开始创建主体...")
                        best_prompt_id = None
                        for p_id, p_status in ss['prompts'].items():
                            if p_status == T_DONE:
                                best_prompt_id = p_id
                                break

                        if best_prompt_id:
                            frontal_url = task_state[best_prompt_id].get('show_url')
                            ref_url = ss.get('ref_show_url')
                            refer_list = [ref_url] if ref_url else []
                            description = ss.get('description', ss['name'])[:200]

                            if skip_subject:
                                log(f"  ⏭ 场景「{ss['name']}」跳过创建主体（--skip-subject）")
                            else:
                                element_id = process_actor(
                                    element_name=ss['name'],
                                    element_description=description,
                                    element_frontal_image=frontal_url,
                                    dry_run=False,
                                    element_refer_list=refer_list,
                                )

                                if element_id:
                                    ss['element_id'] = element_id
                                    log(f"  ✅ 场景主体创建成功: {ss['name']} → {element_id}")

                        ss['status'] = S_DONE
                        _finalize_scene_to_output(ss, project_dir, temp_dir)
                        if ss.get('start_time'):
                            log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}")
                        # 触发变体场景
                        default_show_url = task_state[best_prompt_id].get('show_url') if best_prompt_id else None
                        if default_show_url:
                            for v_sid, v_ss in scene_state.items():
                                if v_ss.get('depends_on') == sid and v_ss['status'] == S_PENDING:
                                    v_ss['iref_url'] = default_show_url
                                    v_ss['status'] = S_MAIN_GENERATING
                                    v_ss['start_time'] = time.time()
                                    v_ss['round'] = 1
                                    log(f"  [编排] 触发变体场景「{v_ss['name']}」(iref from {ss['name']})")
                                    for v_pid in v_ss['prompts']:
                                        if v_ss['prompts'][v_pid] == T_PENDING:
                                            submit_pool.submit(_do_submit, v_sid, v_pid)
                    else:
                        # 参考图生成失败，直接完成
                        ss['status'] = S_DONE
                        _finalize_scene_to_output(ss, project_dir, temp_dir)
                        if ss.get('start_time'):
                            log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}（参考图失败）")
                        log(f"  [参考图失败] 场景「{ss['name']}」参考图生成失败，跳过主体创建")
                    # 参考图处理完成，跳过后续的主图处理逻辑
                    _write_json(scene_path, scene_state)
                    _write_json(task_path, task_state)
                    continue

                # 处理主图生成结果
                ts = task_state[pid]
                ss = scene_state[sid]

                if msg['status'] == T_DONE:
                    ts['status'] = T_DONE
                    ts['image_path'] = msg.get('image_path')
                    ts['show_url'] = msg.get('show_url')
                    ss['prompts'][pid] = T_DONE
                    log(f"  [完成] {ss['name']} / {pid[:8]}... 生图成功")

                elif msg['status'] == T_FAILED:
                    ts['status'] = T_FAILED
                    ts['reject_reason'] = msg.get('reason', '')
                    ss['prompts'][pid] = T_FAILED
                    log(f"  [失败] {ss['name']} / {pid[:8]}... {msg.get('reason', '')}")

                # 统一检查场景状态：所有 prompt 都有终态（完成或失败）
                prompt_statuses = list(ss['prompts'].values())
                all_terminal = all(v in (T_DONE, T_FAILED) for v in prompt_statuses)
                if all_terminal and ss["status"] == S_MAIN_GENERATING:
                    has_success = any(v == T_DONE for v in prompt_statuses)
                    all_failed = all(v == T_FAILED for v in prompt_statuses)

                    if all_failed and ss['round'] < MAX_REVIEW_ROUNDS:
                        # 全部失败但还有重试机会 → 整个场景重新提交
                        ss['round'] += 1
                        log(f"  [重试] 场景「{ss['name']}」全部失败，第{ss['round']}轮重新生成")
                        for retry_pid in ss['prompts']:
                            task_state[retry_pid]['status'] = T_PENDING
                            ss['prompts'][retry_pid] = T_PENDING
                            submit_pool.submit(_do_submit, sid, retry_pid)
                    elif all_failed:
                        # 全部失败且达到最大轮次 → 放弃
                        ss['status'] = S_DONE
                        if ss.get('start_time'):
                            log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}（全部失败）")
                        log(f"  [放弃] 场景「{ss['name']}」全部失败，达到最大轮次")
                    elif has_success:
                        # 有成功的 → 把所有成功的prompt都投入审核
                        ss["status"] = S_MAIN_WAIT_REVIEW
                        success_prompts = [(p, task_state[p]) for p, v in ss['prompts'].items() if v == T_DONE]
                        log(f"  [编排] 场景「{ss['name']}」所有prompt已有终态，投入审核队列（共{len(success_prompts)}个候选）")
                        review_q.put({
                            "scene_id": sid, "scene_name": ss['name'],
                            "scene_description": ss.get('description', ''),
                            "candidates": [
                                {
                                    "prompt_id": pid,
                                    "image_path": ts['image_path'],
                                    "prompt": ts['prompt'],
                                }
                                for pid, ts in success_prompts
                            ],
                            "script_context": "",
                        })

            elif msg['type'] == 'review_result':
                sid = msg['scene_id']
                ss = scene_state[sid]
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
                    log(f"  [通过] 场景「{ss['name']}」审核通过（最佳候选评分: {msg.get('best_score', 0):.2f}）")
                    ss['main_task_id'] = best_prompt_id
                    ss['_main_show_url'] = task_state[best_prompt_id].get('show_url', '')
                    # 暂存到 temp 目录
                    _stage_scene_images_single(ss, task_state[best_prompt_id], temp_dir)

                    # 生成参考图（特写附图）
                    if skip_ref:
                        log(f"  ⏭ 场景「{ss['name']}」跳过参考图生成（--skip-ref）")
                        if best_prompt_id:
                            frontal_url = task_state[best_prompt_id].get('show_url')
                            if skip_subject:
                                log(f"  ⏭ 场景「{ss['name']}」跳过创建主体（--skip-subject）")
                            else:
                                element_id = process_actor(
                                    element_name=ss['name'],
                                    element_description=ss.get('description', ss['name'])[:200],
                                    element_frontal_image=frontal_url,
                                    dry_run=False,
                                    element_refer_list=[frontal_url],
                                )
                                if element_id:
                                    ss['element_id'] = element_id
                                    log(f"  ✅ 场景主体创建成功: {ss['name']} → {element_id}")

                        ss['status'] = S_DONE
                        _finalize_scene_to_output(ss, project_dir, temp_dir)
                        if ss.get('start_time'):
                            log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}")
                        should_trigger_variants = True
                    else:
                        best_ts = task_state[best_prompt_id] if best_prompt_id else task_state[list(ss['prompts'].keys())[0]]
                        params = {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
                        main_show_url = best_ts.get('show_url')
                        if main_show_url:
                            description = ss.get('description') or ss['name']
                            ref_prompt = _GC["generate_scenes"]["ref_prompt_template"].format(description=description)
                            params["iref"] = [main_show_url]
                            log(f"  [参考图] 道具「{ss['name']}」开始生成参考图 tmp_prompt: {ref_prompt} params: {params}...")
                            ref_task_id = submit_image_task(ref_prompt, params)
                            if ref_task_id:
                                # 将参考图任务投入轮询队列
                                now = time.time()
                                ref_prompt_id = f"{best_prompt_id}_ref"
                                ss['ref_task_id'] = ref_prompt_id
                                pending_q.put({
                                    "prompt_id": ref_prompt_id,
                                    "scene_id": sid,
                                    "scene_name": ss['name'],
                                    "api_task_id": ref_task_id,
                                    "created_at": now,
                                    "timeout": TASK_TIMEOUT,
                                    "check_count": 0,
                                    "error_count": 0,
                                    "next_check_at": now + 3,
                                    "is_ref": True,  # 标记为参考图任务
                                })
                                ss['status'] = S_REF_GENERATING  # 等待参考图生成
                                log(f"  [参考图] 场景「{ss['name']}」参考图任务已提交: {ref_task_id}")
                            else:
                                # 参考图提交失败，直接完成
                                ss['status'] = S_DONE
                                _finalize_scene_to_output(ss, project_dir, temp_dir)
                                if ss.get('start_time'):
                                    log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}（参考图提交失败）")
                                should_trigger_variants = True
                        else:
                            ss['status'] = S_DONE
                            _finalize_scene_to_output(ss, project_dir, temp_dir)
                            if ss.get('start_time'):
                                log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}")
                            should_trigger_variants = True
                else:
                    reason = msg.get('reason', '')
                    log(f"  [驳回] 场景「{ss['name']}」审核不通过: {reason[:60]}")
                    if ss['round'] < MAX_REVIEW_ROUNDS:
                        ss['round'] += 1
                        ss['status'] = S_MAIN_GENERATING
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
                        log(f"  [重试] 场景「{ss['name']}」第{ss['round']}轮重新生成")
                    else:
                        log(f"  [强制通过] 场景「{ss['name']}」达到最大审核轮次，强制完成")
                        if best_prompt_id:
                            ss['main_task_id'] = best_prompt_id
                            ss['_main_show_url'] = task_state[best_prompt_id].get('show_url', '')
                            _stage_scene_images_single(ss, task_state[best_prompt_id], temp_dir)

                            # 生成参考图（与正常通过路径一致）
                            if skip_ref:
                                log(f"  ⏭ 场景「{ss['name']}」跳过参考图生成（--skip-ref）")
                                frontal_url = task_state[best_prompt_id].get('show_url')
                                if frontal_url:
                                    if skip_subject:
                                        log(f"  ⏭ 场景「{ss['name']}」跳过创建主体（--skip-subject）")
                                    else:
                                        log(f"  [创建主体] 场景「{ss['name']}」强制通过后创建主体...")
                                        element_id = process_actor(
                                            element_name=ss['name'],
                                            element_description=ss.get('description', ss['name'])[:200],
                                            element_frontal_image=frontal_url,
                                            dry_run=False,
                                            element_refer_list=[frontal_url],
                                        )
                                        if element_id:
                                            ss['element_id'] = element_id
                                            log(f"  ✅ 场景主体创建成功: {ss['name']} → {element_id}")
                                ss['status'] = S_DONE
                                _finalize_scene_to_output(ss, project_dir, temp_dir)
                                if ss.get('start_time'):
                                    log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}（强制通过）")
                                should_trigger_variants = True
                            else:
                                best_ts = task_state[best_prompt_id]
                                params = {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
                                main_show_url = best_ts.get('show_url')
                                if main_show_url:
                                    description = ss.get('description') or ss['name']
                                    ref_prompt = _GC["generate_scenes"]["ref_prompt_template"].format(description=description)
                                    params["iref"] = [main_show_url]
                                    log(f"  [参考图] 场景「{ss['name']}」强制通过后开始生成参考图 tmp_prompt: {ref_prompt} params: {params}...")
                                    ref_task_id = submit_image_task(ref_prompt, params)
                                    if ref_task_id:
                                        now = time.time()
                                        ref_prompt_id = f"{best_prompt_id}_ref"
                                        ss['ref_task_id'] = ref_prompt_id
                                        pending_q.put({
                                            "prompt_id": ref_prompt_id,
                                            "scene_id": sid,
                                            "scene_name": ss['name'],
                                            "api_task_id": ref_task_id,
                                            "created_at": now,
                                            "timeout": TASK_TIMEOUT,
                                            "check_count": 0,
                                            "error_count": 0,
                                            "next_check_at": now + 3,
                                            "is_ref": True,
                                        })
                                        ss['status'] = S_REF_GENERATING
                                        log(f"  [参考图] 场景「{ss['name']}」参考图任务已提交: {ref_task_id}")
                                    else:
                                        ss['status'] = S_DONE
                                        _finalize_scene_to_output(ss, project_dir, temp_dir)
                                        if ss.get('start_time'):
                                            log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}（强制通过，参考图提交失败）")
                                        should_trigger_variants = True
                                else:
                                    ss['status'] = S_DONE
                                    _finalize_scene_to_output(ss, project_dir, temp_dir)
                                    if ss.get('start_time'):
                                        log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}（强制通过）")
                                    should_trigger_variants = True
                        else:
                            ss['status'] = S_DONE
                            _finalize_scene_to_output(ss, project_dir, temp_dir)
                            if ss.get('start_time'):
                                log(f"  [耗时] 场景「{ss['name']}」耗时 {_fmt_elapsed(ss['start_time'])}（强制通过）")
                            should_trigger_variants = True

                # 统一触发依赖此场景的 variant 场景
                if should_trigger_variants:
                    # 使用评分最高的prompt作为iref
                    if best_prompt_id:
                        default_show_url = task_state[best_prompt_id].get('show_url')
                    else:
                        first_pid = list(ss['prompts'].keys())[0]
                        default_show_url = task_state[first_pid].get('show_url')
                    for v_sid, v_ss in scene_state.items():
                        if v_ss.get('depends_on') == sid and v_ss['status'] == S_PENDING:
                            v_ss['iref_url'] = default_show_url
                            v_ss['status'] = S_MAIN_GENERATING
                            v_ss['start_time'] = time.time()
                            v_ss['round'] = 1
                            log(f"  [编排] 触发变体场景「{v_ss['name']}」(iref from {ss['name']})")
                            for v_pid in v_ss['prompts']:
                                if v_ss['prompts'][v_pid] == T_PENDING:
                                    submit_pool.submit(_do_submit, v_sid, v_pid)

            # 每次处理消息后更新状态文件
            _write_json(scene_path, scene_state)
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
    total = len(scene_state)
    done = sum(1 for ss in scene_state.values() if ss['status'] == S_DONE)
    _m, _s = divmod(int(_wall_end - _wall_start), 60)

    log(f"\n=== 场景生成完成 ===")
    log(f"  总计: {total}, 完成: {done}, 耗时: {_m:02d}:{_s:02d}")
    log(f"  输出: {project_dir}/locations/")
    log(f"  状态: {scene_path}")

    # ── 生成场景元数据 JSON（已在每个场景完成时通过 _finalize_scene_to_output 增量更新）──
    locations_json_path = Path(project_dir) / "locations" / "locations.json"
    if locations_json_path.exists():
        log(f"  元数据: {locations_json_path}（增量更新）")

    if temp_dir.exists() and not debug:
        shutil.rmtree(str(temp_dir), ignore_errors=True)
    close_logging()


# ══════════════════════════════════════════════════════════════════════════════
# CLI 入口
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="场景图片自动生成（3线程架构）")
    parser.add_argument("--scenes-json", required=True, help="场景 JSON 文件路径")
    parser.add_argument("--project-dir", required=True, help="项目输出目录")
    parser.add_argument("--workspace", default=None, help="工作区目录")
    parser.add_argument("--scripts-dir", default=None, help="剧本目录")
    parser.add_argument("--debug", action="store_true", help="调试模式，保留 _temp 临时文件")
    parser.add_argument("--skip-ref", action="store_true", default=False, help="跳过参考图生成（默认不跳过）")
    parser.add_argument("--regenerate", default=None, help="指定重新生成的场景名称，逗号分隔，如 \"客厅,卧室\"")
    parser.add_argument("--skip-subject", action="store_true", default=False, help="跳过创建主体（默认不跳过）")
    args = parser.parse_args()
    generate_scenes(args.scenes_json, args.project_dir, args.workspace, args.scripts_dir, args.debug, args.skip_ref, args.regenerate, args.skip_subject)
