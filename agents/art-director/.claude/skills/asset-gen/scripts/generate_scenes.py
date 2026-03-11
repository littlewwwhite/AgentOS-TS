#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
场景图片全自动生成脚本（独立 skill）

流程：
  1. 读取 scenes.json，筛选指定集数的场景
  2. 每个场景生成 1 张主图
  3. Gemini 全局审图（仅场景）
  4. 有问题则删除旧图并重新生成（最多 3 轮）
  5. 审核通过后生成参考表（特写附图）
  6. Gemini 参考表审图（风格一致性 + 多视角布局，最多 2 轮）
  7. 保存到新目录结构: scene/{场景名}/主图.png + 特写附图.png + scene.json
  8. 生成全局索引: scene/scene.json

输出目录结构：
  {project-dir}/scene/{场景名}/主图.png          场景主图
  {project-dir}/scene/{场景名}/特写附图.png      多角度参考表
  {project-dir}/scene/{场景名}/scene.json        元数据（subject_id, main, auxiliary）
  {project-dir}/scene/scene.json                全局场景索引

用法:
  python generate_scenes.py --episode 1 \
    --scenes-json "path/to/scenes.json" \
    --project-dir "path/to/project"
"""
import sys, os, json, re, time, argparse, subprocess, shutil, hashlib
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

# Step 0 世界观分析脚本路径
GENERATE_STYLE_SCRIPT = Path(__file__).parent / "generate_style.py"

# UTF-8 输出
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# shared auth module
sys.path.insert(0, str(Path(__file__).resolve().parent))
import auth

# ── 加载统一审核配置 ──────────────────────────────────────────────────────────
import pathlib as _pathlib, json as _json
_REVIEW_CONFIG_PATH = _pathlib.Path(__file__).parent / "review_config.json"
with open(_REVIEW_CONFIG_PATH, "r", encoding="utf-8") as _f:
    _RC = _json.load(_f)

# ── 加载生成配置 ───────────────────────────────────────────────────────────────
_GENERATION_CONFIG_PATH = _pathlib.Path(__file__).parent / "generation_config.json"
with open(_GENERATION_CONFIG_PATH, "r", encoding="utf-8") as _f:
    _GC = _json.load(_f)

# 配置
BASE_URL              = "https://animeworkbench.lingjingai.cn"
SCENE_REVIEW_SCRIPT   = Path(__file__).parent / "scene_review.py"
MAX_REVIEW_ROUNDS     = _RC["review_rounds"]["max_review_rounds"]
MAX_REF_REVIEW_ROUNDS = _RC["review_rounds"]["max_ref_review_rounds"]

# 全局日志文件句柄
_log_file = None


def setup_logging(workspace_dir):
    """设置日志输出到文件和控制台"""
    global _log_file

    # 创建 logs 目录
    logs_dir = Path(workspace_dir) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    # 生成日志文件名（带时间戳）
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file_path = logs_dir / f"scene_gen_{timestamp}.log"

    # 打开日志文件
    _log_file = open(log_file_path, 'w', encoding='utf-8')

    print(f"[{time.strftime('%H:%M:%S')}] 📝 日志文件: {log_file_path}", flush=True)
    return log_file_path


def log(msg):
    """同时输出到控制台和日志文件"""
    timestamp = time.strftime('%H:%M:%S')
    formatted_msg = f"[{timestamp}] {msg}"

    # 输出到控制台
    print(formatted_msg, flush=True)

    # 输出到日志文件
    if _log_file:
        _log_file.write(formatted_msg + '\n')
        _log_file.flush()


def close_logging():
    """关闭日志文件"""
    global _log_file
    if _log_file:
        _log_file.close()
        _log_file = None


def log_progress(asset_type, current, total, status="生成中"):
    """输出统一格式的进度信息

    Args:
        asset_type: 资产类型 ("角色", "场景", "道具")
        current: 当前完成数量
        total: 总数量
        status: 状态描述 ("生成中", "已完成")
    """
    print(f"[进度] {asset_type}: {current}/{total} {status}", flush=True)


def load_style_config(scenes_json_path, scenes_data, design_json, gemini_key):
    """加载或自动生成 style.json，返回 style dict 或 None"""
    style_json_ref = scenes_data.get('style_config', '')
    if not style_json_ref:
        log("⚠ scenes.json 中未指定 style_config，将使用通用审图标准")
        return None

    scenes_dir = Path(scenes_json_path).parent
    style_path = scenes_dir / style_json_ref

    if style_path.exists():
        with open(style_path, 'r', encoding='utf-8') as f:
            style_data = json.load(f)
        wt = style_data.get('worldview_type', '未知')
        log(f"✓ 已加载风格配置: {style_path.name}  世界观: 【{wt}】")
        return style_data

    # style.json 不存在，尝试 Gemini 自动生成
    if design_json and Path(design_json).exists() and gemini_key:
        log(f"⚠ 风格配置不存在，调用 Gemini 自动分析世界观...")
        try:
            env = {**os.environ, "GEMINI_API_KEY": gemini_key, "PYTHONUTF8": "1"}
            result = subprocess.run(
                ["python", str(GENERATE_STYLE_SCRIPT),
                 "--design-json", design_json,
                 "--output", str(style_path)],
                env=env, capture_output=True, text=True, timeout=180
            )
            if result.returncode == 0 and style_path.exists():
                with open(style_path, 'r', encoding='utf-8') as f:
                    style_data = json.load(f)
                wt = style_data.get('worldview_type', '未知')
                log(f"✓ 风格配置已自动生成: {style_path.name}  世界观: 【{wt}】")
                return style_data
            else:
                log(f"⚠ Gemini 分析失败，将使用通用审图标准")
                if result.stderr:
                    log(f"  错误: {result.stderr[-300:]}")
        except Exception as e:
            log(f"⚠ 风格配置生成异常: {e}")
    else:
        log(f"⚠ 风格配置不存在: {style_path}")
        if not design_json:
            log("  提示: 使用 --design-json 参数指定 design.json 可让 Gemini 自动生成风格配置")

    return None


def generate_subject_id(project, name):
    """生成确定性 subject_id: ss + 8位 hex"""
    raw = f"{project}_scene_{name}"
    return "ss" + hashlib.md5(raw.encode('utf-8')).hexdigest()[:8]


def sanitize_dirname(name):
    """清理目录名中不合法的字符"""
    return re.sub(r'[/\\:*?"<>|]', '_', name)


def detect_variant_base(name, all_names):
    """检测场景名是否为某个基础状态的变体。

    若 name 形如 "{base_name}_{suffix}" 且 base_name 在 all_names 中存在，
    则认为该场景是 base_name 的衍生变体（如「灵霜寝宫_废墟」←「灵霜寝宫」），
    返回 base_name；否则返回 None。
    """
    parts = name.rsplit('_', 1)  # 只拆最后一个下划线
    if len(parts) == 2 and parts[0] in all_names:
        return parts[0]
    return None


def extract_name_from_issue(issue_name):
    """从审图返回的 name 中提取纯中文名称"""
    m = re.search(r'[「【](.+?)[」】]', issue_name)
    return m.group(1) if m else issue_name


def find_target_by_name(items, issue_name):
    """在 scene_images 中按名称查找目标"""
    for item in items:
        if item['scene']['name'] == issue_name and not item['is_reused']:
            return item
    extracted = extract_name_from_issue(issue_name)
    if extracted != issue_name:
        for item in items:
            if item['scene']['name'] == extracted and not item['is_reused']:
                return item
    return None


def extract_script_context(asset_name, asset_type, episodes, scripts_dir):
    """从剧本文件精确提取资产出现的场次文本（调用独立脚本）。

    asset_type='scene': 按场次标题末尾地点名匹配（如 "灵霜寝宫"）
    asset_type='prop' : 按道具名出现在场次正文中匹配
    """
    if not scripts_dir or asset_type != 'scene':
        return ""

    extract_script = Path(__file__).parent / "extract_script_context.py"
    if not extract_script.exists():
        return ""

    try:
        episodes_str = ','.join(map(str, episodes))
        result = subprocess.run(
            ["python", str(extract_script),
             "--asset-name", asset_name,
             "--episodes", episodes_str,
             "--scripts-dir", scripts_dir],
            capture_output=True, text=True, timeout=30, encoding='utf-8'
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return ""
    except Exception:
        return ""


def build_retry_prompt(original_prompt, reason, round_num):
    """根据 Gemini 审图反馈动态修改提示词"""
    additions = []
    for rule in _GC["generate_scenes"]["retry_rules"]:
        if any(kw in reason for kw in rule["keywords"]):
            additions.extend(rule["additions"])

    if not additions:
        return original_prompt

    if round_num >= 1:
        additions.insert(0, 'CRITICAL REQUIREMENT')

    modified = f"{original_prompt}, {', '.join(additions)}"
    log(f"  📝 提示词已增补: +{len(additions)} 个修正关键词")
    return modified


def build_ref_retry_prompt(original_prompt, reason, round_num):
    """根据 Gemini 审图反馈动态修改参考表提示词"""
    additions = []
    for rule in _GC["generate_scenes"]["ref_retry_rules"]:
        if any(kw in reason for kw in rule["keywords"]):
            additions.extend(rule["additions"])

    if not additions:
        additions.extend(_GC["generate_scenes"]["ref_retry_default_additions"])

    if round_num >= 1:
        additions.insert(0, 'CRITICAL REQUIREMENT')

    modified = f"{original_prompt}, {', '.join(additions)}"
    log(f"  📝 参考表提示词已增补: +{len(additions)} 个修正关键词")
    return modified


def get_gemini_key():
    """获取 GEMINI_API_KEY"""
    key = os.getenv("GEMINI_API_KEY")
    if key:
        return key
    try:
        result = subprocess.run(
            ["powershell", "-Command",
             "[System.Environment]::GetEnvironmentVariable('GEMINI_API_KEY', 'User')"],
            capture_output=True, text=True, timeout=5
        )
        key = result.stdout.strip()
        if key:
            return key
    except:
        pass
    return None


def submit_image_task(model_code, prompt, params, max_retries=3):
    """提交图片生成任务"""
    payload = {
        "modelCode": model_code,
        "taskPrompt": prompt,
        "promptParams": params
    }
    for attempt in range(1, max_retries + 1):
        try:
            result = auth.api_request(
                f"{BASE_URL}/api/material/creation/imageCreate",
                data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                method='POST'
            )
            task_id = result.get("data")
            if task_id:
                log(f"  ✓ 任务已提交: {task_id}")
                return task_id
            else:
                log(f"  ⚠ 提交返回无 data (第{attempt}/{max_retries}次): {json.dumps(result, ensure_ascii=False)[:300]}")
        except Exception as e:
            log(f"  ⚠ 提交异常 (第{attempt}/{max_retries}次): {e}")
        if attempt < max_retries:
            time.sleep(2)
    log(f"  ❌ 提交失败，已重试 {max_retries} 次")
    return None


def poll_task(task_id, timeout=600):
    """轮询任务直到完成"""
    start_time = time.time()
    consecutive_errors = 0
    max_consecutive_errors = 10

    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            log(f"  ❌ 超时（{timeout}秒）")
            return None
        try:
            result = auth.api_request(
                f"{BASE_URL}/api/material/creation/imageCreateGet?taskId={task_id}",
                method='GET'
            )
            if result.get("code") != 200:
                consecutive_errors += 1
                log(f"  ⚠ 接口返回错误 ({consecutive_errors}/{max_consecutive_errors}): {result.get('msg')}")
                if consecutive_errors >= max_consecutive_errors:
                    log(f"  ❌ 连续 {max_consecutive_errors} 次接口错误，停止轮询")
                    return None
                time.sleep(3)
                continue
            if not result or "data" not in result:
                time.sleep(3)
                continue
            consecutive_errors = 0
            data = result["data"]
            status = data.get("taskStatus", "UNKNOWN")
            queue_num = data.get("taskQueueNum", "-")

            if status == "SUCCESS":
                result_urls = data.get("resultFileList", [])
                display_urls = data.get("resultFileDisplayList", [])
                log(f"  ✓ 生成成功，获取到 {len(result_urls)} 张图片")
                return {"result": result_urls, "show": display_urls}
            elif status in ("FAIL", "FAILED"):
                log(f"  ❌ 生成失败: {data.get('errorMsg', '未知错误')}")
                return None
            else:
                log(f"  ⏳ 状态: {status}, 队列: {queue_num}, 已等待: {elapsed:.1f}s")
            time.sleep(3)
        except Exception as e:
            consecutive_errors += 1
            log(f"  ⚠ 查询异常 ({consecutive_errors}/{max_consecutive_errors}): {e}")
            if consecutive_errors >= max_consecutive_errors:
                log(f"  ❌ 连续 {max_consecutive_errors} 次请求失败，停止轮询")
                return None
            time.sleep(5)


def download_single_image(url, output_path):
    """下载单张图片"""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["curl", "-s", "-o", str(output_path), url],
            check=True, timeout=60
        )
        log(f"  ✓ 已下载: {output_path.name}")
        return str(output_path)
    except Exception as e:
        log(f"  ❌ 下载失败: {e}")
        return None


def run_scene_review(scene_images, gemini_key, temp_dir, episode, style_data=None):
    """调用场景专用审图脚本（传入世界观信息）"""
    config = {"scenes": []}
    for s in scene_images:
        config["scenes"].append({
            "name": s['scene']['name'],
            "image": s['image_path'],
            "prompt": s['scene']['scene_prompt'],  # 完整提示词，不截断
            "is_reused": s['is_reused'],
            "script_context": s['scene'].get('script_context', '')
        })

    # 注入世界观信息供审图脚本使用
    if style_data:
        config["worldview_type"]    = style_data.get('worldview_type', '通用')
        config["anti_contamination"] = style_data.get('anti_contamination', '')
        config["style_note"]        = style_data.get('style_source', '')

    config_path = Path(temp_dir) / f"_scene_review_ep{episode}.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # 输出审核前的详细日志
    log(f"  📋 准备审核 {len(scene_images)} 个场景:")
    for s in scene_images:
        status = "【已确认】" if s['is_reused'] else "【待审】"
        log(f"    - {status} {s['scene']['name']}: {s['image_path']}")

    try:
        env = {**os.environ, "GEMINI_API_KEY": gemini_key, "PYTHONUTF8": "1"}
        log(f"  🔍 调用 Gemini 审图脚本...")
        result = subprocess.run(
            ["python", str(SCENE_REVIEW_SCRIPT), "--config", str(config_path), "--mode", "main"],
            env=env, capture_output=True, text=True, timeout=300
        )

        # 输出审核脚本的 stderr（包含审核过程日志）
        if result.stderr:
            log(f"  📝 审核过程日志:")
            for line in result.stderr.strip().split('\n'):
                if line.strip():
                    log(f"    {line}")

        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            for line in reversed(lines):
                line = line.strip()
                if line.startswith('{'):
                    try:
                        review_result = json.loads(line)
                        # 输出审核结果详情
                        log(f"  ✅ 审核完成: {'通过' if review_result.get('approved') else '未通过'}")
                        log(f"  💬 评价: {review_result.get('summary', '')}")
                        if review_result.get('issues'):
                            log(f"  ⚠️  发现 {len(review_result['issues'])} 个问题:")
                            for issue in review_result['issues']:
                                log(f"    - [{issue.get('severity', '?')}] {issue.get('name', '?')}: {issue.get('reason', '?')}")
                        return review_result
                    except json.JSONDecodeError:
                        continue
            log(f"  ⚠ 无法解析审图结果")
            return {"approved": True, "summary": "无法解析审图结果，默认通过", "issues": []}
        else:
            stderr_tail = result.stderr[-500:] if result.stderr else "无错误信息"
            log(f"  ⚠ 审图脚本异常: {stderr_tail}")
            return {"approved": True, "summary": "审图脚本异常，默认通过", "issues": []}
    except Exception as e:
        log(f"  ⚠ 审图调用异常: {e}")
        return {"approved": True, "summary": "审图调用异常，默认通过", "issues": []}
    finally:
        if config_path.exists():
            config_path.unlink()


def run_ref_review(ref_images, gemini_key, temp_dir, episode, style_data=None):
    """调用参考表专用审图脚本（对比主图检查风格一致性）"""
    config = {"refs": []}
    for r in ref_images:
        config["refs"].append({
            "name":        r['name'],
            "main_image":  r['main_image'],
            "ref_image":   r['ref_image'],
            "description": r.get('description', '')
        })

    if style_data:
        config["worldview_type"]    = style_data.get('worldview_type', '通用')
        config["anti_contamination"] = style_data.get('anti_contamination', '')
        config["style_note"]        = style_data.get('style_source', '')

    config_path = Path(temp_dir) / f"_ref_review_ep{episode}.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # 输出审核前的详细日志
    log(f"  📋 准备审核 {len(ref_images)} 个参考表:")
    for r in ref_images:
        log(f"    - {r['name']}: 主图={r['main_image']}, 参考表={r['ref_image']}")

    try:
        env = {**os.environ, "GEMINI_API_KEY": gemini_key, "PYTHONUTF8": "1"}
        log(f"  🔍 调用 Gemini 参考表审图脚本...")
        result = subprocess.run(
            ["python", str(SCENE_REVIEW_SCRIPT), "--config", str(config_path), "--mode", "ref"],
            env=env, capture_output=True, text=True, timeout=300
        )

        # 输出审核脚本的 stderr（包含审核过程日志）
        if result.stderr:
            log(f"  📝 审核过程日志:")
            for line in result.stderr.strip().split('\n'):
                if line.strip():
                    log(f"    {line}")

        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            for line in reversed(lines):
                line = line.strip()
                if line.startswith('{'):
                    try:
                        review_result = json.loads(line)
                        # 输出审核结果详情
                        log(f"  ✅ 审核完成: {'通过' if review_result.get('approved') else '未通过'}")
                        log(f"  💬 评价: {review_result.get('summary', '')}")
                        if review_result.get('issues'):
                            log(f"  ⚠️  发现 {len(review_result['issues'])} 个问题:")
                            for issue in review_result['issues']:
                                log(f"    - [{issue.get('severity', '?')}] {issue.get('name', '?')}: {issue.get('reason', '?')}")
                        return review_result
                    except json.JSONDecodeError:
                        continue
            log("  ⚠ 无法解析参考表审图结果")
            return {"approved": True, "summary": "无法解析参考表审图结果，默认通过", "issues": []}
        else:
            stderr_tail = result.stderr[-500:] if result.stderr else "无错误信息"
            log(f"  ⚠ 参考表审图脚本异常: {stderr_tail}")
            return {"approved": True, "summary": "参考表审图脚本异常，默认通过", "issues": []}
    except Exception as e:
        log(f"  ⚠ 参考表审图调用异常: {e}")
        return {"approved": True, "summary": "参考表审图调用异常，默认通过", "issues": []}
    finally:
        if config_path.exists():
            config_path.unlink()

def save_scene_to_project(scene_image, project_dir, project_name):
    """保存单个场景到新目录结构"""
    scene = scene_image['scene']
    name = scene['name']
    safe_name = sanitize_dirname(name)
    location_id = scene.get('id') or safe_name
    subject_id = generate_subject_id(project_name, name)

    scene_dir = Path(project_dir) / "scene" / safe_name
    scene_dir.mkdir(parents=True, exist_ok=True)

    # 复制主图
    main_dst = scene_dir / "主图.png"
    src = Path(scene_image['image_path'])
    if src.exists():
        shutil.copy2(str(src), str(main_dst))
        log(f"  ✓ 场景「{name}」→ scene/{safe_name}/主图.png")

    # 复制特写附图（参考表）
    aux_dst = scene_dir / "特写附图.png"
    if scene_image.get('ref_path'):
        ref_src = Path(scene_image['ref_path'])
        if ref_src.exists():
            shutil.copy2(str(ref_src), str(aux_dst))
            log(f"  ✓ 参考表「{name}」→ scene/{safe_name}/特写附图.png")

    # 生成 per-scene JSON
    scene_meta = {
        "subject_id": subject_id,
        "main": f"scene/{safe_name}/主图.png",
        "auxiliary": f"scene/{safe_name}/特写附图.png"
    }
    with open(scene_dir / "scene.json", 'w', encoding='utf-8') as f:
        json.dump(scene_meta, f, ensure_ascii=False, indent=4)

    return location_id, name, scene_meta


def generate_global_index(all_scenes_meta, project_dir):
    """生成全局 scene/scene.json 索引"""
    scene_root = Path(project_dir) / "scene"
    scene_root.mkdir(parents=True, exist_ok=True)

    index = {}
    for location_id, scene_name, meta in all_scenes_meta:
        index[location_id] = {"name": scene_name, **meta}

    with open(scene_root / "scene.json", 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=4)
    log(f"  ✓ 全局索引 → scene/scene.json（{len(index)} 个场景）")


def generate_scenes(episode, scenes_json, project_dir, workspace=None, design_json=None, scripts_dir=None):
    """生成指定集数的所有场景图片（episode=None时生成项目所有场景）"""
    # 设置 workspace 默认值
    if not workspace:
        workspace = project_dir

    # 初始化日志文件
    try:
        setup_logging(workspace)
    except Exception as e:
        print(f"⚠ 日志文件初始化失败: {e}", flush=True)

    scope_desc = f"第{episode}集" if episode else "项目所有"
    log(f"=== 开始生成{scope_desc}场景图 ===")
    log(f"模式: Step0风格分析 → 主图生成 → Gemini主图审图 → 特写附图 → Gemini参考表审图 → 保存新目录结构")

    gemini_key = get_gemini_key()
    if gemini_key:
        log(f"✓ GEMINI_API_KEY 已加载（长度: {len(gemini_key)}）")
    else:
        log("⚠ GEMINI_API_KEY 未设置，将跳过审图")

    # 读取 JSON
    with open(scenes_json, 'r', encoding='utf-8') as f:
        scenes_data = json.load(f)

    project_name = scenes_data.get('project', 'unknown')
    # 项目级生成(episode=None)时不过滤,否则按集数过滤
    if episode is None:
        scenes = scenes_data['scenes']
    else:
        scenes = [s for s in scenes_data['scenes'] if episode in s['episodes']]
    log(f"本集包含 {len(scenes)} 个场景")
    log_progress("场景", 0, len(scenes), "生成中")

    # ==========================================
    # 预分析：从剧本提取各场景出现的场次上下文
    # ==========================================
    if scripts_dir:
        log("\n=== 预分析：从剧本提取场景出现的场次 ===")
        for scene in scenes:
            ctx = extract_script_context(scene['name'], 'scene', scene['episodes'], scripts_dir)
            scene['script_context'] = ctx
            if ctx:
                hit_count = ctx.count('[第')
                first_line = ctx.split('\n')[0]
                log(f"  📖 「{scene['name']}」→ 找到 {hit_count} 处场次: {first_line}")
                for line in ctx.split('\n')[1:4]:
                    if line.strip():
                        log(f"     {line[:120]}")
            else:
                log(f"  ⚠  「{scene['name']}」→ 未在剧本中找到对应场次")

    # 目录（临时文件放 workspace，最终结果放 project_dir）
    project_path = Path(project_dir)
    workspace_path = Path(workspace) if workspace else project_path
    temp_dir = workspace_path / "_temp" / "scenes"
    confirmed_scene_dir = project_path / "scene"

    # ==========================================
    # Step 0: 加载或自动生成世界观风格配置
    # ==========================================
    log("\n=== Step 0：加载世界观风格配置 ===")
    style_data = load_style_config(scenes_json, scenes_data, design_json, gemini_key)

    # ==========================================
    # Phase 1: 生成场景主图（基础状态优先，变体以基础图为 iref）
    # ==========================================
    log("\n=== 第一步：生成场景主图（基础状态优先，变体以基础图为参考）===")
    scene_images = []

    # 识别变体关系：name = "{base_name}_{suffix}" 且 base_name 在本批次中存在
    all_scene_names = {s['name'] for s in scenes}
    for scene in scenes:
        scene['_base_name'] = detect_variant_base(scene['name'], all_scene_names)

    variants = [s for s in scenes if s['_base_name']]
    if variants:
        log(f"检测到 {len(variants)} 个变体场景:")
        for v in variants:
            log(f"  「{v['name']}」← 基础状态「{v['_base_name']}」")

    base_show_url_map = {}  # 基础场景名 → show_url，供变体生成时用作 iref

    indexed_scenes   = list(enumerate(scenes, 1))
    base_indexed     = [(idx, s) for idx, s in indexed_scenes if not s['_base_name']]
    variant_indexed  = [(idx, s) for idx, s in indexed_scenes if s['_base_name']]

    # ─── Pass 1: 基础状态场景 ──────────────────────────────────────────
    base_tasks = []
    for idx, scene in base_indexed:
        scene_name = scene['name']
        safe_name = sanitize_dirname(scene_name)

        existing_main = confirmed_scene_dir / safe_name / "主图.png"
        if existing_main.exists():
            log(f"\n[场景 {idx}/{len(scenes)}] {scene_name} - 已存在，复用")
            scene_images.append({
                'idx': idx, 'scene': scene,
                'image_path': str(existing_main),
                'show_url': None,
                'ref_path': None,
                'is_reused': True
            })
            continue

        log(f"\n[场景 {idx}/{len(scenes)}] {scene_name} - 提交生成（基础状态）")
        task_id = submit_image_task(
            "Nano_Banana_ImageCreate",
            scene['scene_prompt'],
            {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
        )
        if task_id:
            base_tasks.append((idx, scene, task_id))

    if base_tasks:
        log(f"\n并行轮询 {len(base_tasks)} 个基础场景任务...")
        def _poll_base_scene(args):
            idx, scene, task_id = args
            result = poll_task(task_id)
            if result and result["result"]:
                img = temp_dir / f"scene_{idx:02d}_{sanitize_dirname(scene['name'])}.png"
                dl = download_single_image(result["result"][0], img)
                if dl:
                    su = (result.get("show") or [None])[0]
                    return {'idx': idx, 'scene': scene, 'image_path': dl, 'show_url': su, 'ref_path': None, 'is_reused': False}
            return None
        with ThreadPoolExecutor(max_workers=len(base_tasks)) as ex:
            for r in ex.map(_poll_base_scene, base_tasks):
                if r:
                    scene_images.append(r)
                    if r['show_url']:
                        base_show_url_map[r['scene']['name']] = r['show_url']

    # ─── Pass 2: 变体状态场景（以基础图为 iref 保证风格一致）──────────
    if variant_indexed:
        log(f"\n--- 变体状态场景（以基础图为 iref）---")
    variant_tasks = []
    for idx, scene in variant_indexed:
        scene_name = scene['name']
        safe_name = sanitize_dirname(scene_name)

        existing_main = confirmed_scene_dir / safe_name / "主图.png"
        if existing_main.exists():
            log(f"\n[场景 {idx}/{len(scenes)}] {scene_name} - 已存在，复用")
            scene_images.append({
                'idx': idx, 'scene': scene,
                'image_path': str(existing_main),
                'show_url': None,
                'ref_path': None,
                'is_reused': True
            })
            continue

        base_name = scene['_base_name']
        iref_url = base_show_url_map.get(base_name)
        params = {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
        if iref_url:
            params["iref"] = [iref_url]
            log(f"\n[场景 {idx}/{len(scenes)}] {scene_name} - 提交生成（以「{base_name}」为参考图）")
        else:
            log(f"\n[场景 {idx}/{len(scenes)}] {scene_name} - 提交生成（基础图「{base_name}」本次未生成，无 iref）")

        task_id = submit_image_task(
            "Nano_Banana_ImageCreate",
            scene['scene_prompt'],
            params
        )
        if task_id:
            variant_tasks.append((idx, scene, task_id))

    if variant_tasks:
        log(f"\n并行轮询 {len(variant_tasks)} 个变体场景任务...")
        def _poll_variant_scene(args):
            idx, scene, task_id = args
            result = poll_task(task_id)
            if result and result["result"]:
                img = temp_dir / f"scene_{idx:02d}_{sanitize_dirname(scene['name'])}.png"
                dl = download_single_image(result["result"][0], img)
                if dl:
                    su = (result.get("show") or [None])[0]
                    return {'idx': idx, 'scene': scene, 'image_path': dl, 'show_url': su, 'ref_path': None, 'is_reused': False}
            return None
        with ThreadPoolExecutor(max_workers=len(variant_tasks)) as ex:
            for r in ex.map(_poll_variant_scene, variant_tasks):
                if r:
                    scene_images.append(r)

    # ==========================================
    # Phase 2: Gemini 审图
    # ==========================================
    new_count = sum(1 for s in scene_images if not s['is_reused'])
    if scene_images and gemini_key:
        log(f"\n=== 第二步：Gemini 场景审图（共{len(scene_images)}个场景，其中{new_count}个新生成）===")

        for review_round in range(MAX_REVIEW_ROUNDS):
            log(f"\n--- 审查轮次 {review_round + 1}/{MAX_REVIEW_ROUNDS} ---")
            review_result = run_scene_review(scene_images, gemini_key, temp_dir, episode, style_data)

            log(f"审查结果: {'✓ 通过' if review_result.get('approved') else '✗ 未通过'}")
            log(f"评价: {review_result.get('summary', '')}")

            if review_result.get('approved', True):
                log("✓ 场景审图通过！")
                break

            issues = review_result.get('issues', [])
            if not issues:
                log("⚠ 审图未通过但无具体问题，默认通过")
                break

            log(f"发现 {len(issues)} 个问题:")
            for issue in issues:
                log(f"  [{issue.get('severity', '?')}] 「{issue.get('name', '?')}」: {issue.get('reason', '?')}")

            # 并行提交所有需要重新生成的任务
            retry_tasks = []
            for issue in issues:
                issue_name = issue.get('name', '')
                target = find_target_by_name(scene_images, issue_name)

                if target:
                    log(f"\n准备重新生成场景「{target['scene']['name']}」...")
                    old_path = Path(target['image_path'])
                    if old_path.exists():
                        old_path.unlink()
                        log(f"  ✓ 已删除旧图: {old_path.name}")

                    retry_prompt = build_retry_prompt(
                        target['scene']['scene_prompt'],
                        issue.get('reason', ''), review_round
                    )
                    task_id = submit_image_task(
                        "Nano_Banana_ImageCreate", retry_prompt,
                        {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
                    )
                    if task_id:
                        retry_tasks.append((target, task_id))
                else:
                    log(f"  ⚠ 「{issue_name}」为复用图片或未找到，跳过")

            # 并行轮询所有重新生成任务
            regenerated = False
            if retry_tasks:
                log(f"\n并行轮询 {len(retry_tasks)} 个重新生成任务...")

                def _poll_retry(args):
                    target, task_id = args
                    log(f"等待场景「{target['scene']['name']}」完成...")
                    result = poll_task(task_id)
                    if result and result["result"]:
                        new_path = temp_dir / f"scene_{target['idx']:02d}_{sanitize_dirname(target['scene']['name'])}.png"
                        downloaded = download_single_image(result["result"][0], new_path)
                        if downloaded:
                            target['image_path'] = downloaded
                            target['show_url'] = result["show"][0] if result.get("show") else None
                            return True
                    return False

                with ThreadPoolExecutor(max_workers=len(retry_tasks)) as executor:
                    results = list(executor.map(_poll_retry, retry_tasks))
                    regenerated = any(results)

            if not regenerated:
                log("⚠ 本轮无法重新生成任何图片，退出审查循环")
                break
        else:
            log(f"\n⚠ 达到最大审查轮次（{MAX_REVIEW_ROUNDS}），部分问题可能未完全解决")

    # 审核完成后立即保存主图到 output（不等参考表生成）
    log("\n=== 提前保存审核通过的场景主图 ===")
    for s in scene_images:
        if not s['is_reused'] and s.get('image_path') and Path(s['image_path']).exists():
            scene_name = s['scene']['name']
            safe_name = sanitize_dirname(scene_name)
            scene_dir = Path(project_dir) / "scene" / safe_name
            scene_dir.mkdir(parents=True, exist_ok=True)
            main_dst = scene_dir / "主图.png"
            src_path = Path(s['image_path'])
            if src_path.resolve() != main_dst.resolve():
                shutil.copy2(str(src_path), str(main_dst))
                log(f"  💾 「{scene_name}」主图已保存")

    # ==========================================
    # Phase 3: 生成特写附图（参考表，每个1张）
    # ==========================================
    log("\n=== 第三步：生成特写附图（场景参考表）===")
    ref_tasks = []

    for s in scene_images:
        scene = s['scene']
        idx = s['idx']
        scene_name = scene['name']
        safe_name = sanitize_dirname(scene_name)

        # 检查已存在
        existing_ref = confirmed_scene_dir / safe_name / "特写附图.png"
        if existing_ref.exists():
            log(f"\n[参考表 {idx}] {scene_name} - 已存在，跳过")
            s['ref_path'] = str(existing_ref)
            continue

        if not s.get('show_url'):
            log(f"\n[参考表 {idx}] {scene_name} - 无展示URL（复用图片），跳过")
            continue

        log(f"\n[参考表 {idx}] {scene_name} - 提交生成")

        # 提取场景描述
        prompt = scene['scene_prompt']
        start = prompt.find("no people, no characters,") + len("no people, no characters,")
        end = prompt.find("cinematic lighting, highly detailed")
        description = prompt[start:end].strip() if start > 0 and end > 0 else prompt

        ref_prompt = _GC["generate_scenes"]["ref_prompt_template"].format(description=description)

        s['ref_prompt'] = ref_prompt  # 保存原始参考表提示词，供 Phase 3.5 重试使用

        task_id = submit_image_task(
            "Nano_Banana_ImageCreate", ref_prompt,
            {"quality": "2K", "ratio": "16:9", "generate_num": "1", "iref": [s['show_url']]}
        )
        if task_id:
            ref_tasks.append((idx, scene, task_id, s))

    # 并行轮询参考表
    if ref_tasks:
        log(f"\n并行轮询 {len(ref_tasks)} 个参考表任务...")
        def _poll_ref_scene(args):
            idx, scene, task_id, s_item = args
            result = poll_task(task_id)
            if result and result["result"]:
                rp = temp_dir / f"scene_{idx:02d}_{sanitize_dirname(scene['name'])}_ref.png"
                dl = download_single_image(result["result"][0], rp)
                if dl:
                    s_item['ref_path'] = dl
        with ThreadPoolExecutor(max_workers=len(ref_tasks)) as ex:
            list(ex.map(_poll_ref_scene, ref_tasks))

    # ==========================================
    # Phase 3.5: Gemini 参考表审图（风格一致性 + 多视角布局）
    # ==========================================
    all_refs = [s for s in scene_images if s.get('ref_path')]
    new_refs = [s for s in all_refs if not s['is_reused']]
    if all_refs and gemini_key:
        log(f"\n=== 第三步半：Gemini 参考表审图（共{len(all_refs)}个，其中{len(new_refs)}个新生成）===")

        for ref_round in range(MAX_REF_REVIEW_ROUNDS):
            log(f"\n--- 参考表审查轮次 {ref_round + 1}/{MAX_REF_REVIEW_ROUNDS} ---")

            review_items = [
                {
                    'name':        s['scene']['name'],
                    'main_image':  s['image_path'],
                    'ref_image':   s['ref_path'],
                    'description': s['scene'].get('scene_prompt', '')[:300]
                }
                for s in scene_images
                if s.get('ref_path')  # 包含所有有参考表的场景，不管是否复用
            ]

            ref_review_result = run_ref_review(review_items, gemini_key, temp_dir, episode, style_data)

            log(f"参考表审查结果: {'✓ 通过' if ref_review_result.get('approved') else '✗ 未通过'}")
            log(f"评价: {ref_review_result.get('summary', '')}")

            if ref_review_result.get('approved', True):
                log("✓ 参考表审图通过！")
                break

            issues = ref_review_result.get('issues', [])
            if not issues:
                log("⚠ 参考表审图未通过但无具体问题，默认通过")
                break

            log(f"发现 {len(issues)} 个问题:")
            for issue in issues:
                log(f"  [{issue.get('severity', '?')}] 「{issue.get('name', '?')}」: {issue.get('reason', '?')}")

            # 并行提交所有需要重新生成的参考表任务
            retry_ref_tasks = []
            for issue in issues:
                issue_name = issue.get('name', '')
                target = None
                for s_item in scene_images:
                    if s_item['scene']['name'] == issue_name and not s_item['is_reused']:
                        target = s_item
                        break
                # 尝试名称模糊匹配
                if not target:
                    extracted = extract_name_from_issue(issue_name)
                    if extracted != issue_name:
                        for s_item in scene_images:
                            if s_item['scene']['name'] == extracted and not s_item['is_reused']:
                                target = s_item
                                break

                if target and target.get('show_url') and target.get('ref_prompt'):
                    log(f"\n准备重新生成「{target['scene']['name']}」参考表...")
                    old_path = Path(target['ref_path'])
                    if old_path.exists():
                        old_path.unlink()
                        log(f"  ✓ 已删除旧参考表: {old_path.name}")

                    retry_ref_prompt = build_ref_retry_prompt(
                        target['ref_prompt'], issue.get('reason', ''), ref_round
                    )
                    task_id = submit_image_task(
                        "Nano_Banana_ImageCreate", retry_ref_prompt,
                        {"quality": "2K", "ratio": "16:9", "generate_num": "1",
                         "iref": [target['show_url']]}
                    )
                    if task_id:
                        retry_ref_tasks.append((target, task_id))
                else:
                    log(f"  ⚠ 「{issue_name}」未找到、无展示URL或无原始提示词，跳过")

            # 并行轮询所有参考表重新生成任务
            regenerated = False
            if retry_ref_tasks:
                log(f"\n并行轮询 {len(retry_ref_tasks)} 个参考表重新生成任务...")

                def _poll_ref_retry(args):
                    target, task_id = args
                    log(f"等待参考表「{target['scene']['name']}」完成...")
                    result = poll_task(task_id)
                    if result and result["result"]:
                        idx = target['idx']
                        new_ref_path = temp_dir / f"scene_{idx:02d}_{sanitize_dirname(target['scene']['name'])}_ref.png"
                        downloaded = download_single_image(result["result"][0], new_ref_path)
                        if downloaded:
                            target['ref_path'] = downloaded
                            return True
                    return False

                with ThreadPoolExecutor(max_workers=len(retry_ref_tasks)) as executor:
                    results = list(executor.map(_poll_ref_retry, retry_ref_tasks))
                    regenerated = any(results)

            if not regenerated:
                log("⚠ 本轮无法重新生成任何参考表，退出审查循环")
                break
        else:
            log(f"\n⚠ 达到参考表最大审查轮次（{MAX_REF_REVIEW_ROUNDS}），部分问题可能未完全解决")

    # ==========================================
    # Phase 4: 保存到新目录结构
    # ==========================================
    log("\n=== 第四步：保存到新目录结构 ===")
    all_scenes_meta = []

    for s in scene_images:
        if not s['is_reused']:
            location_id, scene_name, meta = save_scene_to_project(s, project_dir, project_name)
            all_scenes_meta.append((location_id, scene_name, meta))
        else:
            # 复用的也加入索引，并补写单个 scene.json
            scene = s['scene']
            scene_name = scene['name']
            safe_name = sanitize_dirname(scene_name)
            location_id = scene.get('id') or safe_name
            subject_id = generate_subject_id(project_name, scene_name)
            meta = {
                "subject_id": subject_id,
                "main": f"scene/{safe_name}/主图.png",
                "auxiliary": f"scene/{safe_name}/特写附图.png"
            }
            scene_dir = Path(project_dir) / "scene" / safe_name
            scene_dir.mkdir(parents=True, exist_ok=True)
            with open(scene_dir / "scene.json", 'w', encoding='utf-8') as f:
                json.dump(meta, f, ensure_ascii=False, indent=4)
            all_scenes_meta.append((location_id, scene_name, meta))

    # 生成全局索引
    generate_global_index(all_scenes_meta, project_dir)

    # ==========================================
    # 完成总结
    # ==========================================
    total = len(scene_images)
    new_scenes = sum(1 for s in scene_images if not s['is_reused'])
    refs = sum(1 for s in scene_images if s.get('ref_path'))

    scope_desc = f"第{episode}集" if episode else "项目所有"
    log(f"\n=== {scope_desc}场景生成完成 ===")
    log(f"  场景主图: {total} 个（新生成 {new_scenes}，复用 {total - new_scenes}）")
    log(f"  特写附图: {refs} 个")
    log(f"  输出目录: {project_dir}/scene/")
    log_progress("场景", total, total, "已完成")

    # 清理临时文件
    if temp_dir.exists():
        shutil.rmtree(str(temp_dir), ignore_errors=True)
        log("  ✓ 临时文件已清理")

    # 关闭日志文件
    close_logging()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="场景图片自动生成（独立 skill）")
    parser.add_argument("--episode", type=int, default=None, help="集数（可选，不指定则生成项目所有场景）")
    parser.add_argument("--scenes-json", required=True, help="场景 JSON 文件路径")
    parser.add_argument("--project-dir", required=True, help="项目输出目录（仅存最终结果）")
    parser.add_argument("--workspace", default=None, help="工作区目录（存临时文件，默认同 project-dir）")
    parser.add_argument("--design-json", default=None, help="design.json 路径（用于 Step 0 自动生成 style.json）")
    parser.add_argument("--scripts-dir", default=None, help="剧本 episodes 目录（如 01-script/output/episodes），用于预分析场次上下文")

    args = parser.parse_args()
    generate_scenes(args.episode, args.scenes_json, args.project_dir, args.workspace, args.design_json, args.scripts_dir)
