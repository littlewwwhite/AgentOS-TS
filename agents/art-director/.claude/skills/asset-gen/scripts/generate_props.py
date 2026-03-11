#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
道具图片全自动生成脚本（独立 skill）

流程：
  1. 读取 props.json，筛选指定集数的道具
  2. 每个道具生成 1 张主图
  3. Gemini 全局审图（仅道具）
  4. 有问题则删除旧图并重新生成（最多 3 轮）
  5. 生成特写附图（道具多角度细节参考表）
  6. 保存到新目录结构: props/{道具名}/主图.png + 特写附图.png + props.json
  7. 生成全局索引: props/props.json

输出目录结构：
  {project-dir}/props/{道具名}/主图.png          道具主图
  {project-dir}/props/{道具名}/特写附图.png      多角度细节参考表
  {project-dir}/props/{道具名}/props.json        元数据（subject_id, main, auxiliary）
  {project-dir}/props/props.json                全局道具索引

用法:
  python generate_props.py --episode 1 \
    --props-json "path/to/props.json" \
    --project-dir "path/to/project"
"""
import sys, os, json, re, time, argparse, subprocess, shutil, hashlib
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

# Step 0 世界观分析脚本路径（复用 scene generator 的 generate_style.py）
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
BASE_URL            = "https://animeworkbench.lingjingai.cn"
PROPS_REVIEW_SCRIPT = Path(__file__).parent / "props_review.py"
MAX_REVIEW_ROUNDS   = _RC["review_rounds"]["max_review_rounds"]

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
    log_file_path = logs_dir / f"props_gen_{timestamp}.log"

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


def load_style_config(props_json_path, props_data, design_json, gemini_key):
    """加载或自动生成 style.json，返回 style dict 或 None"""
    style_json_ref = props_data.get('style_config', '')
    if not style_json_ref:
        log("⚠ props.json 中未指定 style_config，将使用通用审图标准")
        return None

    props_dir = Path(props_json_path).parent
    style_path = props_dir / style_json_ref

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
    """生成确定性 subject_id: pp + 8位 hex"""
    raw = f"{project}_prop_{name}"
    return "pp" + hashlib.md5(raw.encode('utf-8')).hexdigest()[:8]


def sanitize_dirname(name):
    """清理目录名中不合法的字符"""
    return re.sub(r'[/\\:*?"<>|]', '_', name)


def detect_variant_base(name, all_names):
    """检测道具名是否为某个基础状态的变体。

    若 name 形如 "{base_name}_{suffix}" 且 base_name 在 all_names 中存在，
    则认为该道具是 base_name 的衍生变体（如「内丹_碎裂」←「内丹」），
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
    """在 prop_images 中按名称查找目标"""
    for item in items:
        if item['prop']['name'] == issue_name and not item['is_reused']:
            return item
    extracted = extract_name_from_issue(issue_name)
    if extracted != issue_name:
        for item in items:
            if item['prop']['name'] == extracted and not item['is_reused']:
                return item
    return None


def extract_script_context(asset_name, asset_type, episodes, scripts_dir):
    """从剧本文件精确提取资产出现的场次文本（调用独立脚本）。

    asset_type='scene': 按场次标题末尾地点名匹配
    asset_type='prop' : 按道具名出现在场次正文中匹配
    """
    if not scripts_dir or asset_type != 'prop':
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


def normalize_prop_prompt(prompt):
    """将旧版产品摄影风格的道具提示词转换为游戏CG风格，并强制注入纯白背景约束"""
    replacements = [
        ('product photography', 'Unreal Engine 5 game item, cinematic item showcase'),
        ('studio lighting,', 'soft volumetric lighting,'),
        ('white background,', 'pure white background,'),
        ('white background', 'pure white background'),
    ]
    modified = prompt
    for old, new in replacements:
        modified = modified.replace(old, new)
    if modified != prompt:
        log(f"  🔄 道具提示词已自动转换为游戏CG风格")

    # ── 强制注入纯白背景约束（无论提示词写了什么都追加）──
    WHITE_BG = _GC["generate_props"]["white_bg_constraint"]
    if "pure white background" not in modified or "NO scene background" not in modified:
        modified = modified.rstrip().rstrip('.') + ". " + WHITE_BG
        log(f"  🔒 已强制追加白底约束")

    return modified


def build_retry_prompt(original_prompt, reason, round_num):
    """根据 Gemini 审图反馈动态修改道具提示词"""
    additions = []
    for rule in _GC["generate_props"]["retry_rules"]:
        if any(kw in reason for kw in rule["keywords"]):
            additions.extend(rule["additions"])

    if not additions:
        return original_prompt

    if round_num >= 1:
        additions.insert(0, 'CRITICAL REQUIREMENT')

    modified = f"{original_prompt}, {', '.join(additions)}"
    log(f"  📝 提示词已增补: +{len(additions)} 个修正关键词")
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


def run_props_review(prop_images, gemini_key, temp_dir, episode, style_data=None):
    """调用道具专用审图脚本（传入世界观信息）"""
    config = {"props": []}
    for p in prop_images:
        config["props"].append({
            "name": p['prop']['name'],
            "image": p['image_path'],
            "prompt": p['prop']['prop_prompt'],  # 完整提示词，不截断
            "is_reused": p['is_reused'],
            "script_context": p['prop'].get('script_context', '')
        })

    # 注入世界观信息供审图脚本使用
    if style_data:
        config["worldview_type"]    = style_data.get('worldview_type', '通用')
        config["anti_contamination"] = style_data.get('anti_contamination', '')
        config["style_note"]        = style_data.get('style_source', '')

    config_path = Path(temp_dir) / f"_props_review_ep{episode}.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # 输出审核前的详细日志
    log(f"  📋 准备审核 {len(prop_images)} 个道具:")
    for p in prop_images:
        status = "【已确认】" if p['is_reused'] else "【待审】"
        log(f"    - {status} {p['prop']['name']}: {p['image_path']}")

    try:
        env = {**os.environ, "GEMINI_API_KEY": gemini_key, "PYTHONUTF8": "1"}
        log(f"  🔍 调用 Gemini 审图脚本...")
        result = subprocess.run(
            ["python", str(PROPS_REVIEW_SCRIPT), "--config", str(config_path)],
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


def save_prop_to_project(prop_image, project_dir, project_name):
    """保存单个道具到新目录结构"""
    prop = prop_image['prop']
    name = prop['name']
    safe_name = sanitize_dirname(name)
    prop_id = prop.get('id') or safe_name
    subject_id = generate_subject_id(project_name, name)

    prop_dir = Path(project_dir) / "props" / safe_name
    prop_dir.mkdir(parents=True, exist_ok=True)

    # 复制主图
    main_dst = prop_dir / "主图.png"
    src = Path(prop_image['image_path'])
    if src.exists():
        shutil.copy2(str(src), str(main_dst))
        log(f"  ✓ 道具「{name}」→ props/{safe_name}/主图.png")

    # 复制特写附图
    aux_dst = prop_dir / "特写附图.png"
    if prop_image.get('ref_path'):
        ref_src = Path(prop_image['ref_path'])
        if ref_src.exists():
            shutil.copy2(str(ref_src), str(aux_dst))
            log(f"  ✓ 特写「{name}」→ props/{safe_name}/特写附图.png")

    # 生成 per-prop JSON
    prop_meta = {
        "subject_id": subject_id,
        "main": f"props/{safe_name}/主图.png",
        "auxiliary": f"props/{safe_name}/特写附图.png"
    }
    with open(prop_dir / "props.json", 'w', encoding='utf-8') as f:
        json.dump(prop_meta, f, ensure_ascii=False, indent=4)

    return prop_id, name, prop_meta


def generate_global_index(all_props_meta, project_dir):
    """生成全局 props/props.json 索引"""
    props_root = Path(project_dir) / "props"
    props_root.mkdir(parents=True, exist_ok=True)

    index = {}
    for prop_id, prop_name, meta in all_props_meta:
        index[prop_id] = {"name": prop_name, **meta}

    with open(props_root / "props.json", 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=4)
    log(f"  ✓ 全局索引 → props/props.json（{len(index)} 个道具）")


def generate_props(episode, props_json, project_dir, workspace=None, design_json=None, scripts_dir=None):
    """生成指定集数的所有道具图片（episode=None时生成项目所有道具）"""
    # 设置 workspace 默认值
    if not workspace:
        workspace = project_dir

    # 初始化日志文件
    try:
        setup_logging(workspace)
    except Exception as e:
        print(f"⚠ 日志文件初始化失败: {e}", flush=True)

    scope_desc = f"第{episode}集" if episode else "项目所有"
    log(f"=== 开始生成{scope_desc}道具图 ===")
    log(f"模式: Step0风格分析 → 主图生成 → Gemini世界观审图 → 特写附图 → 保存新目录结构")

    gemini_key = get_gemini_key()
    if gemini_key:
        log(f"✓ GEMINI_API_KEY 已加载（长度: {len(gemini_key)}）")
    else:
        log("⚠ GEMINI_API_KEY 未设置，将跳过审图")

    # 读取 JSON
    with open(props_json, 'r', encoding='utf-8') as f:
        props_data = json.load(f)

    project_name = props_data.get('project', 'unknown')
    # 项目级生成(episode=None)时不过滤,否则按集数过滤
    if episode is None:
        props = props_data['props']
    else:
        props = [p for p in props_data['props'] if episode in p['episodes']]
    log(f"本集包含 {len(props)} 个道具")
    log_progress("道具", 0, len(props), "生成中")

    # ==========================================
    # 预分析：从剧本提取各道具出现的场次上下文
    # ==========================================
    if scripts_dir:
        log("\n=== 预分析：从剧本提取道具出现的场次 ===")
        for prop in props:
            ctx = extract_script_context(prop['name'], 'prop', prop['episodes'], scripts_dir)
            prop['script_context'] = ctx
            if ctx:
                hit_count = ctx.count('[第')
                first_line = ctx.split('\n')[0]
                log(f"  📖 「{prop['name']}」→ 找到 {hit_count} 处场次: {first_line}")
                for line in ctx.split('\n')[1:4]:
                    if line.strip():
                        log(f"     {line[:120]}")
            else:
                log(f"  ⚠  「{prop['name']}」→ 未在剧本中找到对应场次")

    # 目录（临时文件放 workspace，最终结果放 project_dir）
    project_path = Path(project_dir)
    workspace_path = Path(workspace) if workspace else project_path
    temp_dir = workspace_path / "_temp" / "props"
    confirmed_props_dir = project_path / "props"

    # ==========================================
    # Step 0: 加载或自动生成世界观风格配置
    # ==========================================
    log("\n=== Step 0：加载世界观风格配置 ===")
    style_data = load_style_config(props_json, props_data, design_json, gemini_key)

    # ==========================================
    # Phase 1: 生成道具主图（基础状态优先，变体以基础图为 iref）
    # ==========================================
    log("\n=== 第一步：生成道具主图（基础状态优先，变体以基础图为参考）===")
    prop_images = []

    # 识别变体关系：name = "{base_name}_{suffix}" 且 base_name 在本批次中存在
    all_prop_names = {p['name'] for p in props}
    for prop in props:
        prop['_base_name'] = detect_variant_base(prop['name'], all_prop_names)

    variants = [p for p in props if p['_base_name']]
    if variants:
        log(f"检测到 {len(variants)} 个变体道具:")
        for v in variants:
            log(f"  「{v['name']}」← 基础状态「{v['_base_name']}」")

    base_show_url_map = {}  # 基础道具名 → show_url，供变体生成时用作 iref

    indexed_props    = list(enumerate(props, 1))
    base_indexed     = [(idx, p) for idx, p in indexed_props if not p['_base_name']]
    variant_indexed  = [(idx, p) for idx, p in indexed_props if p['_base_name']]

    # ─── Pass 1: 基础状态道具 ──────────────────────────────────────────
    base_tasks = []
    for idx, prop in base_indexed:
        prop_name = prop['name']
        safe_name = sanitize_dirname(prop_name)

        existing_main = confirmed_props_dir / safe_name / "主图.png"
        if existing_main.exists():
            log(f"\n[道具 {idx}/{len(props)}] {prop_name} - 已存在，复用")
            prop_images.append({
                'idx': idx, 'prop': prop,
                'image_path': str(existing_main),
                'show_url': None,
                'ref_path': None,
                'is_reused': True
            })
            continue

        log(f"\n[道具 {idx}/{len(props)}] {prop_name} - 提交生成（基础状态）")
        task_id = submit_image_task(
            "Nano_Banana_ImageCreate",
            normalize_prop_prompt(prop['prop_prompt']),
            {"quality": "2K", "ratio": "1:1", "generate_num": "1"}
        )
        if task_id:
            base_tasks.append((idx, prop, task_id))

    if base_tasks:
        log(f"\n并行轮询 {len(base_tasks)} 个基础道具任务...")
        def _poll_base_prop(args):
            idx, prop, task_id = args
            result = poll_task(task_id)
            if result and result["result"]:
                img = temp_dir / f"prop_{idx:02d}_{sanitize_dirname(prop['name'])}.png"
                dl = download_single_image(result["result"][0], img)
                if dl:
                    su = (result.get("show") or [None])[0]
                    return {'idx': idx, 'prop': prop, 'image_path': dl, 'show_url': su, 'ref_path': None, 'is_reused': False}
            return None
        with ThreadPoolExecutor(max_workers=len(base_tasks)) as ex:
            for r in ex.map(_poll_base_prop, base_tasks):
                if r:
                    prop_images.append(r)
                    if r['show_url']:
                        base_show_url_map[r['prop']['name']] = r['show_url']

    # ─── Pass 2: 变体状态道具（以基础图为 iref 保证风格一致）──────────
    if variant_indexed:
        log(f"\n--- 变体状态道具（以基础图为 iref）---")
    variant_tasks = []
    for idx, prop in variant_indexed:
        prop_name = prop['name']
        safe_name = sanitize_dirname(prop_name)

        existing_main = confirmed_props_dir / safe_name / "主图.png"
        if existing_main.exists():
            log(f"\n[道具 {idx}/{len(props)}] {prop_name} - 已存在，复用")
            prop_images.append({
                'idx': idx, 'prop': prop,
                'image_path': str(existing_main),
                'show_url': None,
                'ref_path': None,
                'is_reused': True
            })
            continue

        base_name = prop['_base_name']
        iref_url = base_show_url_map.get(base_name)
        params = {"quality": "2K", "ratio": "1:1", "generate_num": "1"}
        if iref_url:
            params["iref"] = [iref_url]
            log(f"\n[道具 {idx}/{len(props)}] {prop_name} - 提交生成（以「{base_name}」为参考图）")
        else:
            log(f"\n[道具 {idx}/{len(props)}] {prop_name} - 提交生成（基础图「{base_name}」本次未生成，无 iref）")

        task_id = submit_image_task(
            "Nano_Banana_ImageCreate",
            normalize_prop_prompt(prop['prop_prompt']),
            params
        )
        if task_id:
            variant_tasks.append((idx, prop, task_id))

    if variant_tasks:
        log(f"\n并行轮询 {len(variant_tasks)} 个变体道具任务...")
        def _poll_variant_prop(args):
            idx, prop, task_id = args
            result = poll_task(task_id)
            if result and result["result"]:
                img = temp_dir / f"prop_{idx:02d}_{sanitize_dirname(prop['name'])}.png"
                dl = download_single_image(result["result"][0], img)
                if dl:
                    su = (result.get("show") or [None])[0]
                    return {'idx': idx, 'prop': prop, 'image_path': dl, 'show_url': su, 'ref_path': None, 'is_reused': False}
            return None
        with ThreadPoolExecutor(max_workers=len(variant_tasks)) as ex:
            for r in ex.map(_poll_variant_prop, variant_tasks):
                if r:
                    prop_images.append(r)

    # ==========================================
    # Phase 2: Gemini 审图
    # ==========================================
    new_count = sum(1 for p in prop_images if not p['is_reused'])
    if prop_images and gemini_key:
        log(f"\n=== 第二步：Gemini 道具审图（共{len(prop_images)}个道具，其中{new_count}个新生成）===")

        for review_round in range(MAX_REVIEW_ROUNDS):
            log(f"\n--- 审查轮次 {review_round + 1}/{MAX_REVIEW_ROUNDS} ---")
            review_result = run_props_review(prop_images, gemini_key, temp_dir, episode, style_data)

            log(f"审查结果: {'✓ 通过' if review_result.get('approved') else '✗ 未通过'}")
            log(f"评价: {review_result.get('summary', '')}")

            if review_result.get('approved', True):
                log("✓ 道具审图通过！")
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
                target = find_target_by_name(prop_images, issue_name)

                if target:
                    log(f"\n准备重新生成道具「{target['prop']['name']}」...")
                    old_path = Path(target['image_path'])
                    if old_path.exists():
                        old_path.unlink()
                        log(f"  ✓ 已删除旧图: {old_path.name}")

                    base_prompt = normalize_prop_prompt(target['prop']['prop_prompt'])
                    retry_prompt = build_retry_prompt(
                        base_prompt, issue.get('reason', ''), review_round
                    )
                    task_id = submit_image_task(
                        "Nano_Banana_ImageCreate", retry_prompt,
                        {"quality": "2K", "ratio": "1:1", "generate_num": "1"}
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
                    log(f"等待道具「{target['prop']['name']}」完成...")
                    result = poll_task(task_id)
                    if result and result["result"]:
                        new_path = temp_dir / f"prop_{target['idx']:02d}_{sanitize_dirname(target['prop']['name'])}.png"
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

    # 审核完成后立即保存主图到 output（不等特写附图生成）
    log("\n=== 提前保存审核通过的道具主图 ===")
    for p in prop_images:
        if not p['is_reused'] and p.get('image_path') and Path(p['image_path']).exists():
            prop_name = p['prop']['name']
            safe_name = sanitize_dirname(prop_name)
            prop_dir = Path(project_dir) / "props" / safe_name
            prop_dir.mkdir(parents=True, exist_ok=True)
            main_dst = prop_dir / "主图.png"
            src_path = Path(p['image_path'])
            if src_path.resolve() != main_dst.resolve():
                shutil.copy2(str(src_path), str(main_dst))
                log(f"  💾 「{prop_name}」主图已保存")

    # ==========================================
    # Phase 3: 生成特写附图（道具参考表，每个1张）
    # ==========================================
    log("\n=== 第三步：生成特写附图（道具细节参考表）===")
    ref_tasks = []

    for p in prop_images:
        prop = p['prop']
        idx = p['idx']
        prop_name = prop['name']
        safe_name = sanitize_dirname(prop_name)

        # 检查已存在
        existing_ref = confirmed_props_dir / safe_name / "特写附图.png"
        if existing_ref.exists():
            log(f"\n[特写 {idx}] {prop_name} - 已存在，跳过")
            p['ref_path'] = str(existing_ref)
            continue

        if not p.get('show_url'):
            log(f"\n[特写 {idx}] {prop_name} - 无展示URL（复用图片），跳过")
            continue

        log(f"\n[特写 {idx}] {prop_name} - 提交生成")

        # 提取道具描述部分
        prompt = prop['prop_prompt']
        # 从 "full length view of" 之后提取描述
        start_marker = "full length view of"
        start = prompt.find(start_marker)
        if start >= 0:
            start += len(start_marker)
        else:
            start = 0
        end_markers = ["entire object visible", "centered composition", "cinematic lighting, highly detailed"]
        end = len(prompt)
        for marker in end_markers:
            pos = prompt.find(marker)
            if pos > 0 and pos < end:
                end = pos
        description = prompt[start:end].strip().rstrip(',').strip()

        ref_prompt = f"""4K resolution, master-level quality, item reference sheet for animation production.
Maintain the original style, material language, color palette, lighting from the reference image.
No people, no hands, no readable text, no logos, no UI, no watermarks.

Layout structure (single canvas):

[LEFT - Full View]
Complete item from main viewing angle, showing overall silhouette and proportions.
Clean background, centered composition.

[CENTER - Multi-Angle Views, vertically stacked]
(a) Front view: direct frontal perspective showing the primary face of the item.
(b) Side view: 90-degree rotation showing profile and depth.
(c) Back view: rear perspective showing any hidden details or mechanisms.
All views must maintain consistent lighting and material rendering.

[RIGHT - Detail Breakdown, 3-4 close-up shots]
Select the most distinctive material textures, engravings, ornamental details, or special visual effects of the item.
Emphasize realistic material rendering: wear, scratches, patina, reflections, surface texture, metal oxidation.
Show any glowing effects, spiritual energy, or special visual properties.

Item description: {description}"""

        task_id = submit_image_task(
            "Nano_Banana_ImageCreate", ref_prompt,
            {"quality": "2K", "ratio": "1:1", "generate_num": "1", "iref": [p['show_url']]}
        )
        if task_id:
            ref_tasks.append((idx, prop, task_id, p))

    # 并行轮询特写附图
    if ref_tasks:
        log(f"\n并行轮询 {len(ref_tasks)} 个特写附图任务...")
        def _poll_ref_prop(args):
            idx, prop, task_id, p_item = args
            result = poll_task(task_id)
            if result and result["result"]:
                rp = temp_dir / f"prop_{idx:02d}_{sanitize_dirname(prop['name'])}_ref.png"
                dl = download_single_image(result["result"][0], rp)
                if dl:
                    p_item['ref_path'] = dl
        with ThreadPoolExecutor(max_workers=len(ref_tasks)) as ex:
            list(ex.map(_poll_ref_prop, ref_tasks))

    # ==========================================
    # Phase 4: 保存到新目录结构
    # ==========================================
    log("\n=== 第四步：保存到新目录结构 ===")
    all_props_meta = []

    for p in prop_images:
        if not p['is_reused']:
            prop_id, prop_name, meta = save_prop_to_project(p, project_dir, project_name)
            all_props_meta.append((prop_id, prop_name, meta))
        else:
            prop = p['prop']
            prop_name = prop['name']
            safe_name = sanitize_dirname(prop_name)
            prop_id = prop.get('id') or safe_name
            subject_id = generate_subject_id(project_name, prop_name)
            meta = {
                "subject_id": subject_id,
                "main": f"props/{safe_name}/主图.png",
                "auxiliary": f"props/{safe_name}/特写附图.png"
            }
            all_props_meta.append((prop_id, prop_name, meta))

    # 生成全局索引
    generate_global_index(all_props_meta, project_dir)

    # ==========================================
    # 完成总结
    # ==========================================
    total = len(prop_images)
    new_props = sum(1 for p in prop_images if not p['is_reused'])
    refs = sum(1 for p in prop_images if p.get('ref_path'))

    scope_desc = f"第{episode}集" if episode else "项目所有"
    log(f"\n=== {scope_desc}道具生成完成 ===")
    log(f"  道具主图: {total} 个（新生成 {new_props}，复用 {total - new_props}）")
    log(f"  特写附图: {refs} 个")
    log(f"  输出目录: {project_dir}/props/")
    log_progress("道具", total, total, "已完成")

    # 清理临时文件
    if temp_dir.exists():
        shutil.rmtree(str(temp_dir), ignore_errors=True)
        log("  ✓ 临时文件已清理")

    # 关闭日志文件
    close_logging()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="道具图片自动生成（独立 skill）")
    parser.add_argument("--episode", type=int, default=None, help="集数（可选，不指定则生成项目所有道具）")
    parser.add_argument("--props-json", required=True, help="道具 JSON 文件路径")
    parser.add_argument("--project-dir", required=True, help="项目输出目录（仅存最终结果）")
    parser.add_argument("--workspace", default=None, help="工作区目录（存临时文件，默认同 project-dir）")
    parser.add_argument("--design-json", default=None, help="design.json 路径（用于 Step 0 自动生成 style.json）")
    parser.add_argument("--scripts-dir", default=None, help="剧本 episodes 目录（如 01-script/output/episodes），用于预分析场次上下文")

    args = parser.parse_args()
    generate_props(args.episode, args.props_json, args.project_dir, args.workspace, args.design_json, args.scripts_dir)
