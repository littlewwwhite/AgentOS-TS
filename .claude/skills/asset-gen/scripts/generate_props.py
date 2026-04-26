#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
道具图片全自动生成脚本 —— 3 线程 + 队列架构

线程模型：
  线程1(编排+提交): 解析JSON → 线程池提交生图 → 监听inbox_q → 写JSON
  线程2(轮询):      监听pending_q → check_task_once → 重入队列 → 完成后投inbox_q
  线程3(审核):      监听review_q → subprocess审核 → 结果投inbox_q

队列：
  pending_q : 线程1 → 线程2  (已提交的api_task_id)
  review_q  : 线程1 → 线程3  (待审核的道具)
  inbox_q   : 线程2/3 → 线程1 (生图结果 + 审核结果)

JSON状态文件（仅线程1写入）：
  props_{uuid}.json : 道具状态
  tasks_{uuid}.json : 任务状态

输出目录结构：
  {project-dir}/props/{道具名}/主图.png          道具主图
  {project-dir}/props/{道具名}/特写附图.png      多角度细节参考表
  {project-dir}/props/{道具名}/props.json        元数据（subject_id, main, auxiliary）
  {project-dir}/props/props.json                全局道具索引

用法:
  python generate_props.py \\
    --props-json "path/to/props.json" \\
    --project-dir "path/to/project"
"""
import sys, os, json, re, time, argparse, subprocess, shutil, threading, uuid, queue
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from style_generate import load_project_style
from common_create_subjects import process_actor

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

# ── 加载统一审核配置 ──────────────────────────────────────────────────────────
from common_config import get_review_config, get_config
_RC = get_review_config()

# ── 加载生成配置 ───────────────────────────────────────────────────────────────
_GC = get_config()

# ── 常量 ──────────────────────────────────────────────────────────────────────
PROPS_REVIEW_SCRIPT = Path(__file__).parent / "review_props.py"
MAX_REVIEW_ROUNDS = _RC["review_rounds"]["prop"].get("max_ref_review_rounds", 4)
POLL_INTERVAL = 5          # 轮询间隔（秒）
TASK_TIMEOUT = 600         # 单任务超时（秒）
SUBMIT_WORKERS = 10        # 提交线程池大小
POLL_WORKERS = 2           # 轮询线程池大小
REVIEW_WORKERS = 10         # 审核线程池大小

# ── 道具/任务状态常量 ─────────────────────────────────────────────────────────
P_PENDING = "未生成"
P_MAIN_GENERATING = "主图进行中"
P_MAIN_WAIT_REVIEW = "主图待审核"
P_MAIN_REVIEWING = "主图审核中"
P_REF_GENERATING = "参考图进行中"
P_REF_WAIT_REVIEW = "参考图待审核"
P_REF_REVIEWING = "参考图审核中"
P_DONE = "已生成"

T_PENDING = "未开始"
T_RUNNING = "进行中"
T_DONE = "已完成"
T_FAILED = "已失败"

# 全局日志文件句柄
_log_file = None
_log_lock = threading.Lock()
_thread_local = threading.local()


def setup_logging(workspace_dir):
    global _log_file
    logs_dir = Path(workspace_dir) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file_path = logs_dir / f"props_gen_{timestamp}.log"
    _log_file = open(log_file_path, 'w', encoding='utf-8')
    print(f"[{time.strftime('%H:%M:%S')}] 📝 日志文件: {log_file_path}", flush=True)
    return log_file_path


def log(msg):
    timestamp = time.strftime('%H:%M:%S')
    prefix = getattr(_thread_local, 'asset_prefix', '')
    formatted_msg = f"[{timestamp}] {prefix}{msg}"
    with _log_lock:
        print(formatted_msg, flush=True)
        if _log_file:
            _log_file.write(formatted_msg + '\n')
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


def build_retry_prompt(original_prompt, reason, label="提示词"):
    """根据审核失败原因，调用 Gemini 智能重写提示词（删除问题词 + 增加修正词）。"""
    reason_display = f"{reason[:60]}..." if len(reason) > 60 else reason
    log(f"  📝 调用 Gemini 重写{label} (原因: {reason_display})")
    log(f"  📄 原始{label}: {original_prompt}")
    gemini_prompt = _GC["prompt_templates"]["retry_prompt_rewrite"].format(
        prompt=original_prompt, reason=reason
    )
    try:
        modified = rewrite_prompt(gemini_prompt)
        log(f"  📄 修正后{label}: {modified}")
        return modified
    except Exception as e:
        log(f"  ⚠ Gemini 重写失败，保持原始{label}: {e}")
        return original_prompt


def _call_review_subprocess(config, mode="main", timeout=300):
    """序列化 config 并调用 review_props.py，返回 review_result dict。"""
    try:
        env = {**os.environ, "PYTHONUTF8": "1"}
        config_json = json.dumps(config, ensure_ascii=False)
        result = subprocess.run(
            [sys.executable, str(PROPS_REVIEW_SCRIPT), "--config", config_json, "--mode", mode],
            env=env, capture_output=True, text=True, timeout=timeout
        )
        if result.stderr:
            for line in result.stderr.strip().split('\n'):
                if line.strip():
                    log(f"    {line}")
        if result.returncode == 0 and result.stdout.strip():
            for line in reversed(result.stdout.strip().split('\n')):
                line = line.strip()
                if line.startswith('{'):
                    try:
                        rv = json.loads(line)
                        log(f"  ✅ 审核: {'通过' if rv.get('approved') else '未通过'} — {rv.get('summary', '')}")
                        return rv
                    except json.JSONDecodeError:
                        continue
        log(f"  ⚠ 审图脚本异常或无法解析，默认通过")
        return {"approved": True, "summary": "默认通过", "issues": []}
    except Exception as e:
        log(f"  ⚠ 审图调用异常: {e}")
        return {"approved": True, "summary": "默认通过", "issues": []}


# ══════════════════════════════════════════════════════════════════════════════
# JSON 状态文件读写（仅线程1调用写入）
# ══════════════════════════════════════════════════════════════════════════════

def _write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _init_prop_state(props_data, run_id, workspace):
    """从 props_gen.json 构建道具状态 + 任务状态，写入 workspace。"""
    props = props_data['props']

    # 按 group 分组，识别 default / variant 依赖
    from collections import defaultdict
    groups = defaultdict(list)
    for p in props:
        groups[p.get('group', p['name'])].append(p)

    prop_state = {}   # prop_id → {...}
    task_state = {}   # prompt_id → {...}

    for group_name, members in groups.items():
        # 取组内 group_default=True 的道具作为默认道具；字段缺失时视为 True；兜底取第一个
        default_prop = next((p for p in members if p.get('group_default', True)), members[0])
        for p in members:
            is_default = (p['id'] == default_prop['id'])
            # 默认道具无依赖；变体道具依赖默认道具的生图结果(iref_url)
            depends_on = None if is_default else default_prop['id']

            prop_id = p['id']

            # 支持新旧两种格式：prop_prompts (数组) 或 prop_prompt (单个)
            prompts_list = p.get('prop_prompts', [])
            if not prompts_list and 'prop_prompt' in p:
                # 兼容旧格式：将单个 prop_prompt 包装为数组
                prompts_list = [{"prompt_id": f"{prop_id}_main", "prompt": p['prop_prompt']}]
            if not prompts_list:
                prompts_list = [{"prompt_id": f"{prop_id}_main", "prompt": ""}]

            prop_state[prop_id] = {
                "prop_id": prop_id,
                "name": p['name'],
                "group": group_name,
                "group_default": is_default,
                "depends_on": depends_on,
                "iref_url": None,
                "status": P_PENDING,
                "round": 0,
                "description": p.get('description', ''),
                "episodes": p.get('episodes', []),
                # 该道具下每个prompt的完成状态 {prompt_id: 任务状态}，用于判断道具是否全部完成
                "prompts": {pp['prompt_id']: T_PENDING for pp in prompts_list},
                "main_task_id": prompts_list[0]['prompt_id'],
                "ref_task_id": None,
                "ref_path": None,
                "ref_show_url": None,
                "element_id": None,
            }

            for pp in prompts_list:
                task_state[pp['prompt_id']] = {
                    "prompt_id": pp['prompt_id'],
                    "prop_id": prop_id,
                    "prompt": pp['prompt'],
                    "api_task_id": None,
                    "status": T_PENDING,
                    "image_path": None,
                    "show_url": None,
                    "score": None,
                    "reject_reason": None,
                    "created_at": None,
                    "timeout": TASK_TIMEOUT,
                }

    prop_path = Path(workspace) / f"prop_state_{run_id}.json"
    task_path = Path(workspace) / f"prop_tasks_{run_id}.json"
    _write_json(prop_path, prop_state)
    _write_json(task_path, task_state)
    return prop_state, task_state, prop_path, task_path


# ══════════════════════════════════════════════════════════════════════════════
# 线程2：轮询线程
# ══════════════════════════════════════════════════════════════════════════════

def _poller_thread(pending_q, inbox_q, stop_event, temp_dir):
    """监听 pending_q，非阻塞轮询 API 状态，完成后投 inbox_q。"""
    log("[线程2-轮询] 启动")

    def _check_once(ticket):
        _thread_local.asset_prefix = f"【{ticket.get('prop_name', '')}】"
        now = time.time()
        if now < ticket.get('next_check_at', 0):
            pending_q.put(ticket)
            return
        if now - ticket.get('created_at', now) > ticket.get('timeout', TASK_TIMEOUT):
            log(f"  [轮询] {ticket['task_id'][:8]}... 超时")
            inbox_q.put({
                "type": "gen_result", "task_id": ticket['task_id'],
                "prop_id": ticket['prop_id'], "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "超时",
                "is_ref": ticket.get("is_ref", False),
            })
            return

        resp = check_task_once(ticket['api_task_id'])
        api_status = resp.get('status', 'UNKNOWN')

        if api_status == 'succeeded':
            result_urls = resp.get('result_urls', [])
            display_urls = resp.get('display_urls', [])
            img_path = None
            if result_urls:
                dst = Path(temp_dir) / sanitize_dirname(ticket.get('prop_name', '')) / f"{ticket['task_id']}_r{ticket.get('round', 1)}.png"
                img_path = download_image(result_urls[0], dst)
            show_url = display_urls[0] if display_urls else (result_urls[0] if result_urls else None)
            inbox_q.put({
                "type": "gen_result", "task_id": ticket['task_id'],
                "prop_id": ticket['prop_id'], "status": T_DONE,
                "image_path": img_path, "show_url": show_url, "reason": "",
                "is_ref": ticket.get("is_ref", False),
            })
        elif api_status in ('FAIL', 'FAILED'):
            log(f"  [轮询] {ticket['task_id'][:8]}... 生成失败: {resp.get('error_msg', '')}")
            inbox_q.put({
                "type": "gen_result", "task_id": ticket['task_id'],
                "prop_id": ticket['prop_id'], "status": T_FAILED,
                "image_path": None, "show_url": None,
                "reason": resp.get('error_msg', '生成失败'),
                "is_ref": ticket.get("is_ref", False),
            })
        elif api_status == 'ERROR':
            ticket['error_count'] = ticket.get('error_count', 0) + 1
            if ticket['error_count'] >= 10:
                inbox_q.put({
                    "type": "gen_result", "task_id": ticket['task_id'],
                    "prop_id": ticket['prop_id'], "status": T_FAILED,
                    "image_path": None, "show_url": None, "reason": "连续查询错误",
                    "is_ref": ticket.get("is_ref", False),
                })
            else:
                ticket['next_check_at'] = now + POLL_INTERVAL
                pending_q.put(ticket)
        else:
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
        prop_id = ticket['prop_id']
        prop_name = ticket['prop_name']
        prop_description = ticket.get('prop_description', '')
        _thread_local.asset_prefix = f"【{prop_name}】"
        candidates = ticket.get('candidates', [])
        mode = ticket.get('mode', 'main')

        # 兼容旧格式（单个图片）
        if not candidates and 'image_path' in ticket:
            candidates = [{
                "prompt_id": "legacy",
                "image_path": ticket['image_path'],
                "prompt": ticket['prompt'],
            }]

        tag = f"{sanitize_dirname(prop_name)}_{time.time_ns()}"

        # 构建审核配置，包含所有候选图片
        config = {
            "props": [
                {
                    "name": cand['prompt_id'],  # 直接用 prompt_id 作为唯一标识
                    "image": cand['image_path'],
                    "prompt": cand['prompt'],
                    "description": prop_description,
                    "is_reused": False,
                }
                for i, cand in enumerate(candidates)
            ]
        }
        if style_data:
            config["worldview_type"] = style_data.get('worldview_type', '通用')
            config["anti_contamination"] = style_data.get('anti_contamination', '')
            config["style_note"] = style_data.get('style_source', '')

        log(f"  [审核] 道具「{prop_name}」开始审核（共{len(candidates)}个候选）...")
        rv = _call_review_subprocess(config, mode)
        log(f"  [审核] 道具「{prop_name}」审核结果 {rv}...")
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

        log(f"  [审核结果] 道具「{prop_name}」最佳候选评分: {best_score:.2f}, {'通过' if approved else '未通过'}")

        # 返回审核结果
        inbox_q.put({
            "type": "review_result", "prop_id": prop_id,
            "approved": approved, "reason": reason,
            "summary": rv.get('summary', ''),
            "best_prompt_id": best_prompt_id,
            "best_score": best_score,
            "candidate_scores": candidate_scores,
            "mode": mode,
        })

    with ThreadPoolExecutor(max_workers=REVIEW_WORKERS) as pool:
        while not stop_event.is_set():
            try:
                ticket = review_q.get(timeout=0.1)
                if ticket is None:
                    break
                log(f"  [审核线程] 收到消息: ticket={ticket}...")
                pool.submit(_do_review, ticket)
            except queue.Empty:
                continue
    log("[线程3-审核] 退出")


# ══════════════════════════════════════════════════════════════════════════════
# 保存道具图片到项目目录
# ══════════════════════════════════════════════════════════════════════════════

# def _save_prop_images(prop_id, prop_state, task_state, project_dir):
#     """将已完成道具的图片复制到 project_dir/props/{道具名}/"""
#     ps = prop_state[prop_id]
#     safe_name = sanitize_dirname(ps['name'])
#     prop_dir = Path(project_dir) / "props" / safe_name
#     prop_dir.mkdir(parents=True, exist_ok=True)
#
#     # 保存所有 prompt 对应的主图
#     prompt_ids = list(ps['prompts'].keys())
#     for idx, pid in enumerate(prompt_ids):
#         if pid in task_state:
#             ts = task_state[pid]
#             if ts.get('image_path') and Path(ts['image_path']).exists():
#                 suffix = "" if idx == 0 else f"_{idx + 1}"
#                 dst = prop_dir / f"主图{suffix}.png"
#                 if not dst.exists():
#                     shutil.copy2(ts['image_path'], str(dst))
#                     log(f"  道具「{ps['name']}」→ props/{safe_name}/主图{suffix}.png")
#
#     # 保存参考图
#     if ps.get('ref_path') and Path(ps['ref_path']).exists():
#         dst = prop_dir / "特写附图.png"
#         if not dst.exists():
#             shutil.copy2(ps['ref_path'], str(dst))
#             log(f"  道具「{ps['name']}」→ props/{safe_name}/特写附图.png")


def _stage_prop_images_single(ps, ts, temp_dir):
    """将最佳候选主图暂存到 temp 目录（道具全部完成后再统一复制到输出目录）

    Args:
        ps: prop_state[prop_id] 道具状态对象
        ts: task_state[best_task_id] 任务状态对象
        temp_dir: 暂存根目录
    """
    safe_name = sanitize_dirname(ps['name'])
    stage_dir = Path(temp_dir) / safe_name
    stage_dir.mkdir(parents=True, exist_ok=True)

    # 只暂存最佳候选的主图
    if ts.get('image_path') and Path(ts['image_path']).exists():
        dst = stage_dir / "主图.png"
        shutil.copy2(ts['image_path'], str(dst))
        log(f"  道具「{ps['name']}」→ temp/{safe_name}/主图.png（最佳候选）")

    # 暂存参考图
    if ps.get('ref_path') and Path(ps['ref_path']).exists():
        dst = stage_dir / "特写附图.png"
        shutil.copy2(ps['ref_path'], str(dst))
        log(f"  道具「{ps['name']}」→ temp/{safe_name}/特写附图.png")

    return stage_dir


def _finalize_prop_to_output(ps, project_dir, temp_dir):
    """将单个道具的所有暂存文件从 temp 复制到最终输出目录，并增量更新 props.json

    Args:
        ps: prop_state[prop_id] 道具状态对象
        project_dir: 项目输出目录
        temp_dir: 暂存根目录
    """
    safe_name = sanitize_dirname(ps['name'])
    src_dir = Path(temp_dir) / safe_name
    dst_dir = Path(project_dir) / "props" / safe_name
    dst_dir.mkdir(parents=True, exist_ok=True)

    # 只复制最终文件到输出目录（跳过轮询下载的临时候选图片）
    _FINAL_FILES = ('主图.png', '特写附图.png')
    if src_dir.exists():
        for name in _FINAL_FILES:
            f = src_dir / name
            if f.exists():
                dst_file = dst_dir / name
                shutil.copy2(str(f), str(dst_file))
                log(f"  [输出] 道具「{ps['name']}」→ props/{safe_name}/{name}")

    # 构建该道具的元数据条目
    prop_id = ps.get('prop_id', '')
    if not prop_id:
        return

    main_file = dst_dir / "主图.png"
    main_path = f"props/{safe_name}/主图.png" if main_file.exists() else ""
    main_url = ""
    if ps.get('main_task_id'):
        main_url = ps.get('_main_show_url', '')

    auxiliary_path = ""
    auxiliary_url = ""
    ref_file = dst_dir / "特写附图.png"
    if ref_file.exists():
        auxiliary_path = f"props/{safe_name}/特写附图.png"
        auxiliary_url = ps.get('ref_show_url', '')

    entry = {
        "name": ps['name'],
        "subject_id": ps.get('element_id', ''),
        "main": main_path,
        "main_url": main_url,
        "auxiliary": auxiliary_path,
        "auxiliary_url": auxiliary_url,
    }

    # 读取现有 props.json（增量合并）
    props_json_path = Path(project_dir) / "props" / "props.json"
    props_metadata = {}
    if props_json_path.exists():
        try:
            with open(props_json_path, 'r', encoding='utf-8') as f:
                props_metadata = json.load(f)
        except Exception as e:
            log(f"  ⚠ 读取 props.json 失败: {e}")

    props_metadata[prop_id] = entry
    props_json_path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(props_json_path, props_metadata)
    log(f"  [props.json] 已更新道具「{ps['name']}」")



def generate_props(props_json, project_dir, workspace=None, scripts_dir=None, debug=False, skip_ref=True, regenerate_names=None, skip_subject=False):
    """3 线程架构的道具生成主入口。"""
    if not workspace:
        workspace = project_dir

    # 解析需要重新生成的道具名称集合
    regenerate_set = set(s.strip() for s in regenerate_names.split(',')) if regenerate_names else set()

    try:
        setup_logging(workspace)
    except Exception as e:
        print(f"日志初始化失败: {e}", flush=True)

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    log(f"=== 道具生成启动 (run_id={run_id}) ===")
    log(f"架构: 3线程 + 队列 (提交{SUBMIT_WORKERS}并发, 轮询{POLL_WORKERS}并发, 审核{REVIEW_WORKERS}并发)")

    # ── 读取道具数据 ──────────────────────────────────────────────────────────
    with open(props_json, 'r', encoding='utf-8') as f:
        props_data = json.load(f)
    project_name = props_data.get('project', 'unknown')
    log(f"项目: {project_name}, 道具数: {len(props_data['props'])}")

    # ── 加载世界观风格 ────────────────────────────────────────────────────────
    style_data = load_project_style(workspace)

    # ── 初始化状态 ────────────────────────────────────────────────────────────
    workspace_path = Path(workspace)
    temp_dir = workspace_path / "_temp" / "props"
    temp_dir.mkdir(parents=True, exist_ok=True)
    project_path = Path(project_dir)

    prop_state, task_state, prop_path, task_path = _init_prop_state(
        props_data, run_id, workspace
    )
    log(f"状态文件: {prop_path.name}, {task_path.name}")

    # ── 检查已存在的道具（断点续传）：从 props.json 判断是否已完成 ──────────────
    props_json_path = project_path / "props" / "props.json"
    existing_metadata = {}
    if props_json_path.exists():
        try:
            with open(props_json_path, 'r', encoding='utf-8') as f:
                existing_metadata = json.load(f)
        except Exception as e:
            log(f"  ⚠ 读取 props.json 失败: {e}")

    for pid, ps in prop_state.items():
        # 指定重新生成的道具跳过断点续传
        if ps['name'] in regenerate_set:
            log(f"  [重新生成] 道具「{ps['name']}」已指定重新生成，跳过检查点")
            continue
        if pid in existing_metadata:
            ps['status'] = P_DONE
            for task_id in ps['prompts']:
                task_state[task_id]['status'] = T_DONE
                ps['prompts'][task_id] = T_DONE
            log(f"  [复用] 道具「{ps['name']}」在 props.json 中已存在，跳过")

    _write_json(prop_path, prop_state)
    _write_json(task_path, task_state)

    # ── 队列 & 事件 ──────────────────────────────────────────────────────────
    pending_q = queue.Queue()
    review_q = queue.Queue()
    inbox_q = queue.Queue()
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

    def _do_submit(prop_id, task_id):
        """在线程池中提交生图任务，结果统一通过 inbox_q 通知线程1。"""
        ps = prop_state[prop_id]
        ts = task_state[task_id]
        _thread_local.asset_prefix = f"【{ps['name']}】"
        safe_prop_name = sanitize_dirname(ps['name'])
        params = {
            "quality": "2K",
            "ratio": "16:9",
            "generate_num": "1",
            "local_dir": str(Path(temp_dir) / safe_prop_name),
            "role": "prop.main",
            "task": "asset.prop.main",
        }
        tmp_prompt = ts['prompt']
        if ps.get('iref_url'):
            params["iref"] = [ps['iref_url']]
            tmp_prompt += "只参考图片的风格："+tmp_prompt

        log(f"  [提交] {ps['name']} / {task_id[:8]} tmp_prompt: {tmp_prompt} params: {params}...")
        api_task_id = submit_image_task(
            "",
            tmp_prompt,
            params=params,
            project_dir=project_dir,
        )

        if api_task_id:
            now = time.time()
            pending_q.put({
                "task_id": task_id,
                "prop_id": prop_id,
                "prop_name": ps['name'],
                "api_task_id": api_task_id,
                "created_at": now,
                "timeout": TASK_TIMEOUT,
                "check_count": 0,
                "error_count": 0,
                "next_check_at": now + 3,
                "is_ref": False,
                "round": ps.get('round', 1),
            })
            inbox_q.put({
                "type": "submit_result", "task_id": task_id,
                "prop_id": prop_id, "api_task_id": api_task_id,
                "created_at": now,
            })
        else:
            inbox_q.put({
                "type": "gen_result", "task_id": task_id,
                "prop_id": prop_id, "status": T_FAILED,
                "image_path": None, "show_url": None, "reason": "提交失败",
                "is_ref": False,
            })

    # ── 提交所有 group_default=true 且未完成的道具 ────────────────────────────
    _wall_start = time.time()
    submitted_count = 0
    for pid, ps in prop_state.items():
        if ps['status'] != P_PENDING:
            continue
        if not ps['group_default']:
            continue
        ps['status'] = P_MAIN_GENERATING
        ps['start_time'] = time.time()
        ps['round'] = 1
        for task_id in ps['prompts']:
            submit_pool.submit(_do_submit, pid, task_id)
            submitted_count += 1

    _write_json(prop_path, prop_state)
    log(f"\n=== 已提交 {submitted_count} 个默认道具主图生成任务 ===")

    # ── 主循环：监听 inbox_q ──────────────────────────────────────────────────
    GLOBAL_TIMEOUT = 3600
    try:
        while True:
            all_done = all(ps['status'] == P_DONE for ps in prop_state.values())
            if all_done:
                break

            if time.time() - _wall_start > GLOBAL_TIMEOUT:
                log(f"  [超时] 全局超时 {GLOBAL_TIMEOUT}s，强制结束")
                # 不要强制将未完成的任务标记为 P_DONE
                # 保持实际状态，这样最终元数据只包含真正完成的道具
                incomplete_count = sum(1 for fps in prop_state.values() if fps['status'] != P_DONE)
                log(f"  [超时] 有 {incomplete_count} 个道具未完成，将保存已完成的道具")
                # 超时时也要保存状态，避免丢失已完成的任务
                _write_json(prop_path, prop_state)
                _write_json(task_path, task_state)
                break

            try:
                msg = inbox_q.get(timeout=0.5)
                _pid = msg.get('prop_id')
                if _pid and _pid in prop_state:
                    _thread_local.asset_prefix = f"【{prop_state[_pid]['name']}】"
                log(f"  [主循环] 收到消息: type={msg.get('type','N/A')}, prop_id={msg.get('prop_id','N/A')}, task_id={str(msg.get('task_id','N/A'))[:8]}, msg={msg}...")
            except queue.Empty:
                continue

            # ── 处理提交结果 ──────────────────────────────────────────────────
            if msg['type'] == 'submit_result':
                tid = msg['task_id']
                ts = task_state[tid]
                ts['api_task_id'] = msg['api_task_id']
                ts['status'] = T_RUNNING
                ts['created_at'] = msg['created_at']
                log(f"  [已提交] {prop_state[msg['prop_id']]['name']} / {tid[:8]}... task_id={msg['api_task_id']}")

            # ── 处理生图结果 ──────────────────────────────────────────────────
            elif msg['type'] == 'gen_result':
                tid = msg['task_id']
                pid = msg['prop_id']
                is_ref = msg.get('is_ref', False)

                # 处理参考图生成结果
                if is_ref:
                    ps = prop_state[pid]
                    if msg['status'] == T_DONE:
                        ps['ref_path'] = msg.get('image_path')
                        ps['ref_show_url'] = msg.get('show_url')
                        log(f"  [参考图完成] 道具「{ps['name']}」参考图生成成功")

                        # 只保存最佳候选（main_task_id）的主图和参考图到 temp
                        best_task_id = ps.get('main_task_id')
                        ps['_main_show_url'] = task_state[best_task_id].get('show_url', '') if best_task_id else ''
                        _stage_prop_images_single(ps, task_state[best_task_id], temp_dir)
                        # else:
                        #     _save_prop_images(pid, prop_state, task_state, project_dir)

                        # 创建主体
                        if skip_subject:
                            log(f"  ⏭ 道具「{ps['name']}」跳过创建主体（--skip-subject）")
                        else:
                            log(f"  [创建主体] 道具「{ps['name']}」开始创建主体...")
                            main_ts = task_state[ps['main_task_id']]
                            frontal_url = main_ts.get('show_url')
                            ref_url = ps.get('ref_show_url')
                            refer_list = [ref_url] if ref_url else ([frontal_url] if frontal_url else [])
                            description = ps.get('description', ps['name'])[:200]

                            element_id = process_actor(
                                element_name=ps['name'],
                                element_description=description,
                                element_frontal_image=frontal_url,
                                dry_run=False,
                                element_refer_list=refer_list,
                            )

                            if element_id:
                                ps['element_id'] = element_id
                                log(f"  ✅ 道具主体创建成功: {ps['name']} → {element_id}")

                        ps['status'] = P_DONE
                        _finalize_prop_to_output(ps, project_dir, temp_dir)
                        if ps.get('start_time'):
                            log(f"  [耗时] 道具「{ps['name']}」耗时 {_fmt_elapsed(ps['start_time'])}")
                        # 触发变体道具
                        default_show_url = main_ts.get('show_url')
                        if default_show_url:
                            for v_pid, v_ps in prop_state.items():
                                if v_ps.get('depends_on') == pid and v_ps['status'] == P_PENDING:
                                    v_ps['iref_url'] = default_show_url
                                    v_ps['status'] = P_MAIN_GENERATING
                                    v_ps['start_time'] = time.time()
                                    v_ps['round'] = 1
                                    log(f"  [编排] 触发变体道具「{v_ps['name']}」(iref from {ps['name']})")
                                    for v_tid in v_ps['prompts']:
                                        if v_ps['prompts'][v_tid] == T_PENDING:
                                            submit_pool.submit(_do_submit, v_pid, v_tid)
                    else:
                        ps['status'] = P_DONE
                        _finalize_prop_to_output(ps, project_dir, temp_dir)
                        if ps.get('start_time'):
                            log(f"  [耗时] 道具「{ps['name']}」耗时 {_fmt_elapsed(ps['start_time'])}（参考图失败）")
                        log(f"  [参考图失败] 道具「{ps['name']}」参考图生成失败，跳过主体创建")

                    _write_json(prop_path, prop_state)
                    _write_json(task_path, task_state)
                    continue

                # 处理主图生成结果
                ts = task_state[tid]
                ps = prop_state[pid]

                if msg['status'] == T_DONE:
                    ts['status'] = T_DONE
                    ts['image_path'] = msg.get('image_path')
                    ts['show_url'] = msg.get('show_url')
                    ps['prompts'][tid] = T_DONE
                    log(f"  [完成] {ps['name']} / {tid[:8]}... 生图成功")

                elif msg['status'] == T_FAILED:
                    ts['status'] = T_FAILED
                    ts['reject_reason'] = msg.get('reason', '')
                    ps['prompts'][tid] = T_FAILED
                    log(f"  [失败] {ps['name']} / {tid[:8]}... {msg.get('reason', '')}")

                # 统一检查：所有 prompt 都有终态后再决策
                prompt_statuses = list(ps['prompts'].values())
                all_terminal = all(v in (T_DONE, T_FAILED) for v in prompt_statuses)
                if all_terminal and ps['status'] == P_MAIN_GENERATING:
                    has_success = any(v == T_DONE for v in prompt_statuses)
                    all_failed  = all(v == T_FAILED for v in prompt_statuses)

                    if all_failed and ps['round'] < MAX_REVIEW_ROUNDS:
                        ps['round'] += 1
                        log(f"  [重试] 道具「{ps['name']}」全部失败，第{ps['round']}轮重新生成")
                        for retry_tid in ps['prompts']:
                            task_state[retry_tid]['status'] = T_PENDING
                            ps['prompts'][retry_tid] = T_PENDING
                            submit_pool.submit(_do_submit, pid, retry_tid)
                    elif all_failed:
                        ps['status'] = P_DONE
                        if ps.get('start_time'):
                            log(f"  [耗时] 道具「{ps['name']}」耗时 {_fmt_elapsed(ps['start_time'])}（全部失败）")
                        log(f"  [放弃] 道具「{ps['name']}」全部失败，达到最大轮次")
                    elif has_success:
                        # 有成功的 → 把所有成功的prompt都投入审核
                        ps["status"] = P_MAIN_WAIT_REVIEW
                        success_prompts = [(p, task_state[p]) for p, v in ps['prompts'].items() if v == T_DONE]
                        log(f"  [编排] 道具「{ps['name']}」所有prompt已有终态，投入审核队列（共{len(success_prompts)}个候选）")
                        review_q.put({
                            "prop_id": pid, "prop_name": ps['name'],
                            "prop_description": ps.get('description', ''),
                            "candidates": [
                                {
                                    "prompt_id": pid_item,
                                    "image_path": ts['image_path'],
                                    "prompt": ts['prompt'],
                                }
                                for pid_item, ts in success_prompts
                            ],
                            "mode": "main",
                        })
                        # 提交审核后立即更新为审核中状态
                        ps['status'] = P_MAIN_REVIEWING

            # ── 处理审核结果 ──────────────────────────────────────────────────
            elif msg['type'] == 'review_result':
                pid = msg['prop_id']
                ps = prop_state[pid]
                should_trigger_variants = False
                best_prompt_id = msg.get('best_prompt_id')
                candidate_scores = msg.get('candidate_scores', {})

                # 将所有候选的评分和驳回原因写入task_state（保留历史）
                current_round = ps['round']
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
                    log(f"  [通过] 道具「{ps['name']}」审核通过（最佳候选评分: {msg.get('best_score', 0):.2f}）")
                    ps['main_task_id'] = best_prompt_id
                    ps['_main_show_url'] = task_state[best_prompt_id].get('show_url', '')
                    # 暂存到 temp 目录
                    _stage_prop_images_single(ps, task_state[best_prompt_id], temp_dir)
                    safe_prop_name = sanitize_dirname(ps['name'])
                    params = {
                        "quality": "2K",
                        "ratio": "16:9",
                        "generate_num": "1",
                        "local_dir": str(Path(temp_dir) / safe_prop_name),
                        "role": "prop.reference",
                        "task": "asset.prop.reference",
                    }
                    # 生成参考图（如果未跳过）
                    if skip_ref:
                        log(f"  ⏭ 道具「{ps['name']}」跳过参考图生成（--skip-ref）")
                        if best_prompt_id:
                            frontal_url = task_state[best_prompt_id].get('show_url')
                            if skip_subject:
                                log(f"  ⏭ 道具「{ps['name']}」跳过创建主体（--skip-subject）")
                            else:
                                element_id = process_actor(
                                    element_name=ps['name'],
                                    element_description=ps.get('description', ps['name'])[:200],
                                    element_frontal_image=frontal_url,
                                    dry_run=False,
                                    element_refer_list=[frontal_url],
                                )
                                if element_id:
                                    ps['element_id'] = element_id
                                    log(f"  ✅ 道具主体创建成功: {ps['name']} → {element_id}")

                        ps['status'] = P_DONE
                        _finalize_prop_to_output(ps, project_dir, temp_dir)
                        if ps.get('start_time'):
                            log(f"  [耗时] 道具「{ps['name']}」耗时 {_fmt_elapsed(ps['start_time'])}")
                        should_trigger_variants = True
                    else:
                        best_ts = task_state[best_prompt_id] if best_prompt_id else task_state[list(ps['prompts'].keys())[0]]
                        main_show_url = best_ts.get('show_url')
                        if main_show_url:
                            description = ps.get('description') or ps['name']
                            ref_prompt = _GC["generate_props"]["ref_prompt_template"].format(description=description)
                            params["iref"] = [main_show_url]
                            log(f"  [参考图] 道具「{ps['name']}」开始生成参考图 tmp_prompt: {ref_prompt} params: {params}...")
                            ref_task_id = submit_image_task(
                                "",
                                ref_prompt,
                                params=params,
                                project_dir=project_dir,
                            )
                            if ref_task_id:
                                now = time.time()
                                pending_q.put({
                                    "task_id": f"{best_prompt_id}_ref",
                                    "prop_id": pid,
                                    "prop_name": ps['name'],
                                    "api_task_id": ref_task_id,
                                    "created_at": now,
                                    "timeout": TASK_TIMEOUT,
                                    "check_count": 0,
                                    "error_count": 0,
                                    "next_check_at": now + 3,
                                    "is_ref": True,
                                })
                                ps['status'] = P_REF_GENERATING
                                log(f"  [参考图] 道具「{ps['name']}」参考图任务已提交: {ref_task_id}")
                            else:
                                # 参考图提交失败，仍尝试创建主体
                                if best_prompt_id:
                                    frontal_url_fb = task_state[best_prompt_id].get('show_url')
                                    if frontal_url_fb:
                                        if skip_subject:
                                            log(f"  ⏭ 道具「{ps['name']}」跳过创建主体（--skip-subject）")
                                        else:
                                            element_id = process_actor(
                                                element_name=ps['name'],
                                                element_description=ps.get('description', ps['name'])[:200],
                                                element_frontal_image=frontal_url_fb,
                                                dry_run=False,
                                                element_refer_list=[frontal_url_fb],
                                            )
                                            if element_id:
                                                ps['element_id'] = element_id
                                                log(f"  ✅ 道具主体创建成功（参考图提交失败兜底）: {ps['name']} → {element_id}")
                                ps['status'] = P_DONE
                                _finalize_prop_to_output(ps, project_dir, temp_dir)
                                if ps.get('start_time'):
                                    log(f"  [耗时] 道具「{ps['name']}」耗时 {_fmt_elapsed(ps['start_time'])}（参考图提交失败）")
                                should_trigger_variants = True
                        else:
                            ps['status'] = P_DONE
                            if ps.get('start_time'):
                                log(f"  [耗时] 道具「{ps['name']}」耗时 {_fmt_elapsed(ps['start_time'])}")
                            should_trigger_variants = True
                else:
                    reason = msg.get('reason', '')
                    log(f"  [驳回] 道具「{ps['name']}」审核不通过: {reason[:60]}")
                    if ps['round'] < MAX_REVIEW_ROUNDS:
                        ps['round'] += 1
                        ps['status'] = P_MAIN_GENERATING
                        # 重写 prompt 并重新提交所有 prompt
                        for pid_task in ps['prompts']:
                            ts = task_state[pid_task]
                            # 保留原始prompt到历史记录
                            if 'prompt_history' not in ts:
                                ts['prompt_history'] = []
                            ts['prompt_history'].append({
                                'round': ps['round'] - 1,
                                'prompt': ts['prompt'],
                                'retry_reason': reason,
                            })
                            # 重写prompt
                            ts['prompt'] = build_retry_prompt(ts['prompt'], reason)
                            ts['status'] = T_PENDING
                            # 更新当前reject_reason（不覆盖历史）
                            ts['reject_reason'] = f"[第{ps['round']-1}轮] {reason}"
                            ps['prompts'][pid_task] = T_PENDING
                            submit_pool.submit(_do_submit, pid, pid_task)
                        log(f"  [重试] 道具「{ps['name']}」第{ps['round']}轮重新生成")
                    else:
                        ps['status'] = P_DONE
                        if ps.get('start_time'):
                            log(f"  [耗时] 道具「{ps['name']}」耗时 {_fmt_elapsed(ps['start_time'])}（强制通过）")
                        log(f"  [强制通过] 道具「{ps['name']}」达到最大审核轮次，强制完成")
                        if best_prompt_id:
                            ps['main_task_id'] = best_prompt_id
                            ps['_main_show_url'] = task_state[best_prompt_id].get('show_url', '')
                            _stage_prop_images_single(ps, task_state[best_prompt_id], temp_dir)
                            # 创建主体
                            frontal_url = task_state[best_prompt_id].get('show_url')
                            if frontal_url:
                                if skip_subject:
                                    log(f"  ⏭ 道具「{ps['name']}」跳过创建主体（--skip-subject）")
                                else:
                                    log(f"  [创建主体] 道具「{ps['name']}」强制通过后创建主体...")
                                    element_id = process_actor(
                                        element_name=ps['name'],
                                        element_description=ps.get('description', ps['name'])[:200],
                                        element_frontal_image=frontal_url,
                                        dry_run=False,
                                        element_refer_list=[frontal_url],
                                    )
                                    if element_id:
                                        ps['element_id'] = element_id
                                        log(f"  ✅ 道具主体创建成功: {ps['name']} → {element_id}")
                        _finalize_prop_to_output(ps, project_dir, temp_dir)
                        should_trigger_variants = True

                # 统一触发依赖此道具的 variant 道具
                if should_trigger_variants:
                    # 使用评分最高的prompt作为iref
                    if best_prompt_id:
                        default_show_url = task_state[best_prompt_id].get('show_url')
                    else:
                        first_pid = list(ps['prompts'].keys())[0]
                        default_show_url = task_state[first_pid].get('show_url')
                    if default_show_url:
                        for v_pid, v_ps in prop_state.items():
                            if v_ps.get('depends_on') == pid and v_ps['status'] == P_PENDING:
                                v_ps['iref_url'] = default_show_url
                                v_ps['status'] = P_MAIN_GENERATING
                                v_ps['start_time'] = time.time()
                                v_ps['round'] = 1
                                log(f"  [编排] 触发变体道具「{v_ps['name']}」(iref from {ps['name']})")
                                for v_tid in v_ps['prompts']:
                                    if v_ps['prompts'][v_tid] == T_PENDING:
                                        submit_pool.submit(_do_submit, v_pid, v_tid)

            _write_json(prop_path, prop_state)
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
    total = len(prop_state)
    done = sum(1 for ps in prop_state.values() if ps['status'] == P_DONE)
    _m, _s = divmod(int(_wall_end - _wall_start), 60)

    log(f"\n=== 道具生成完成 ===")
    log(f"  总计: {total}, 完成: {done}, 耗时: {_m:02d}:{_s:02d}")
    log(f"  输出: {project_dir}/props/")
    log(f"  状态: {prop_path}")

    # ── 生成道具元数据 JSON（已在每个道具完成时通过 _finalize_prop_to_output 增量更新）──
    props_json_path = Path(project_dir) / "props" / "props.json"
    if props_json_path.exists():
        log(f"  元数据: {props_json_path}（增量更新）")

    if temp_dir.exists() and not debug:
        shutil.rmtree(str(temp_dir), ignore_errors=True)
    close_logging()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="道具图片自动生成（独立 skill）")
    parser.add_argument("--props-json",  required=True, help="道具 JSON 文件路径")
    parser.add_argument("--project-dir", required=True, help="项目输出目录")
    parser.add_argument("--workspace",   default=None,  help="工作区目录（存临时文件，默认同 project-dir）")
    parser.add_argument("--scripts-dir", default=None,  help="剧本 episodes 目录，用于预分析场次上下文")
    parser.add_argument("--debug", action="store_true", help="调试模式，保留 _temp 临时文件")
    parser.add_argument("--skip-ref", action="store_true", default=True, help="跳过参考图生成（默认跳过）")
    parser.add_argument("--regenerate", default=None, help="指定重新生成的道具名称，逗号分隔，如 \"手机,钥匙\"")
    parser.add_argument("--skip-subject", action="store_true", default=False, help="跳过创建主体（默认不跳过）")

    args = parser.parse_args()
    generate_props(args.props_json, args.project_dir, args.workspace, args.scripts_dir, args.debug, args.skip_ref, args.regenerate, args.skip_subject)
