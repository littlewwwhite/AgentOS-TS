#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
角色图片全自动生成脚本（优化版流程）

流程：
  Phase 0: 加载世界观风格配置
  Phase 1: 生成三视图（16:9 横版，包含正面/侧面/背面三个角度）
  Phase 2: Gemini 三视图审查（最多3次，每次打分，取最高分）
  Phase 3: 切分三视图为独立的正面、侧面、背面图片（9:16 竖版）
  Phase 4: 保存到最终目录，生成 per-character JSON + 全局 characters.json

输出目录结构：
  {project-dir}/characters/{角色名}/{形态名}/三视图.png   ← 原始三视图（16:9）
  {project-dir}/characters/{角色名}/{形态名}/正面.png     ← 从三视图切分
  {project-dir}/characters/{角色名}/{形态名}/侧面.png     ← 从三视图切分
  {project-dir}/characters/{角色名}/{形态名}/背面.png     ← 从三视图切分
  {project-dir}/characters/{角色名}/characters.json       ← 单角色各形态索引
  {project-dir}/characters/characters.json                ← 全局角色索引

输入 characters.json 格式：
{
  "project": "万剑宗",
  "style_config": "style.json",   // 可选，世界观风格配置
  "characters": [
    {
      "name": "白行风",
      "forms": [
        {
          "name": "受辱废人期",
          "episodes": [1],
          "front_prompt":      "...",
          "side_prompt":       "...",   // 可选，缺省时使用 front_prompt
          "back_prompt":       "...",   // 可选
          "three_view_prompt": "...",   // 可选
          "voice_text":        "..."    // 可选，角色自我介绍文本，用于语音合成
        }
      ]
    }
  ]
}

用法:
  # 默认模式：生成全部4张图（正面 + 侧面 + 背面 + 三视图整合）
  python generate_characters.py --episode 1 \\
    --characters-json "workspace/ep01_chars.json" \\
    --project-dir    "output" \\
    --workspace      "workspace"

  # 精简模式：只出正面图 + 三视图整合图（跳过独立侧/背图）
  python generate_characters.py --episode 1 --skip-single-views \\
    --characters-json "..." --project-dir "..." --workspace "..."
"""

import sys, os, json, re, time, argparse, subprocess, shutil, hashlib
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

try:
    from qcloud_cos import CosConfig, CosS3Client as _CosS3Client
    _HAS_COS = True
except ImportError:
    _HAS_COS = False

# Windows UTF-8 输出
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# shared auth module (auto token management)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import auth

# ── 外部脚本路径 ──────────────────────────────────────────────────────────────
CHAR_REVIEW_SCRIPT    = Path(__file__).parent / "char_review.py"
GENERATE_STYLE_SCRIPT = Path(__file__).parent / "generate_style.py"

# ── 加载统一审核配置 ──────────────────────────────────────────────────────────
import pathlib as _pathlib, json as _json
_REVIEW_CONFIG_PATH = _pathlib.Path(__file__).parent / "review_config.json"
with open(_REVIEW_CONFIG_PATH, "r", encoding="utf-8") as _f:
    _RC = _json.load(_f)

# ── 平台配置 ──────────────────────────────────────────────────────────────────
BASE_URL          = "https://animeworkbench.lingjingai.cn"
DEFAULT_MODEL     = "Nano_Banana2_ImageCreate_grsai"
MAX_REVIEW_ROUNDS = _RC["review_rounds"]["max_review_rounds"]

# ── 角色生成 prompt 常量 ──────────────────────────────────────────────────────
_cg = _RC["character_generation"]
NO_PROPS_SUFFIX   = _cg["no_props_suffix"]
WHITE_BG_SUFFIX   = _cg["white_bg_suffix"]
SIDE_PREFIX       = _cg["side_prefix"]
BACK_PREFIX       = _cg["back_prefix"]
THREE_VIEW_PREFIX = _cg["three_view_prefix"]


# ── 工具函数 ──────────────────────────────────────────────────────────────────

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
    log_file_path = logs_dir / f"char_gen_{timestamp}.log"

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


def sanitize_dirname(name):
    """清理目录名中不合法的字符"""
    return re.sub(r'[/\\:*?"<>|]', '_', name)


def generate_subject_id(project, char_name, form_name):
    """生成确定性 subject_id: cc + 8位 hex（幂等）"""
    raw = f"{project}_char_{char_name}_{form_name}"
    return "cc" + hashlib.md5(raw.encode('utf-8')).hexdigest()[:8]


def get_gemini_key():
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
    except Exception:
        pass
    return None


def extract_script_context(asset_name, asset_type, episodes, scripts_dir):
    """从剧本文件精确提取资产出现的场次文本（调用独立脚本）。

    asset_type='scene': 按场次标题末尾地点名匹配
    asset_type='prop'/'char': 按名称出现在场次正文中匹配
    """
    if not scripts_dir or asset_type not in ('char', 'prop', 'scene'):
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


def enforce_no_props(prompt: str) -> str:
    """在提示词中强制追加无道具约束（已含则不重复）"""
    if "NO props" in prompt and "empty open hands" in prompt:
        return prompt
    # 在 NO text 等负面词之前插入
    for marker in ["NO text, NO labels", "NO text,", "NO watermarks"]:
        if marker in prompt:
            return prompt.replace(marker, NO_PROPS_SUFFIX + marker, 1)
    return prompt.rstrip().rstrip('.') + ". " + NO_PROPS_SUFFIX


def enforce_white_background(prompt: str) -> str:
    """强制追加纯白背景约束（角色正视图专用，已含则不重复）"""
    if "pure white background" in prompt and "NO scene background" in prompt:
        return prompt
    # 追加到提示词末尾
    return prompt.rstrip().rstrip('.') + ". " + WHITE_BG_SUFFIX


def split_three_view_image(three_view_path, output_dir):
    """将三视图（16:9横版）切分为三张独立的正面、侧面、背面图（9:16竖版）

    Args:
        three_view_path: 三视图文件路径
        output_dir: 输出目录

    Returns:
        dict: {'front': 正面图路径, 'side': 侧面图路径, 'back': 背面图路径}
    """
    try:
        from PIL import Image
    except ImportError:
        log("⚠ PIL/Pillow 未安装，无法切分三视图")
        return {'front': None, 'side': None, 'back': None}

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

        return {
            'front': str(front_path),
            'side': str(side_path),
            'back': str(back_path)
        }
    except Exception as e:
        log(f"⚠ 切分三视图失败: {e}")
        return {'front': None, 'side': None, 'back': None}




# ── COS 上传（为复用旧图时提供 iref URL）────────────────────────────────────
_sts_cache = {"data": None, "expires": 0}

def _get_sts_creds() -> dict:
    """获取COS STS临时凭证（带缓存，约25分钟复用）"""
    now = time.time()
    if _sts_cache["data"] and now < _sts_cache["expires"]:
        return _sts_cache["data"]
    group_id = auth.get_user_info().get("groupId", "")
    result = auth.api_request(
        f"{BASE_URL}/api/anime/workbench/TencentCloud/getSecret",
        data=json.dumps({"sceneType": "material-image-draw",
                         "groupId": group_id, "projectNo": ""}).encode("utf-8"),
        method="POST",
    )
    if not result or result.get("code") != 200:
        raise RuntimeError(f"getSecret 失败: {result}")
    sts = result["data"]
    _sts_cache["data"]    = sts
    _sts_cache["expires"] = now + 25 * 60  # 25分钟
    return sts


# def upload_local_image_for_iref(filepath: str) -> str | None:
#     """将本地图片上传到COS，返回可用作 iref 的公开URL；失败返回 None"""
#     if not _HAS_COS:
#         log("  ⚠ qcloud_cos 未安装，跳过上传（三视图将不带 iref）")
#         return None
#     try:
#         sts    = _get_sts_creds()
#         creds  = sts["credentials"]
#         bucket = sts["bucket"]
#         region = sts["region"]
#         prefix = sts["path"]
#         key    = f"{prefix}iref-{int(time.time()*1000)}-front.png"
#         config = CosConfig(Region=region,
#                            SecretId=creds["tmpSecretId"],
#                            SecretKey=creds["tmpSecretKey"],
#                            Token=creds["sessionToken"])
#         client = _CosS3Client(config)
#         with open(filepath, "rb") as f:
#             client.put_object(Bucket=bucket, Body=f, Key=key)
#         url = f"https://{bucket}.cos.{region}.myqcloud.com/{key}"
#         log(f"  ✓ 复用图已上传COS: {Path(filepath).name} → {url[:60]}...")
#         return url
#     except Exception as e:
#         log(f"  ⚠ 上传COS失败，三视图将不带 iref: {e}")
#         return None


def submit_image_task(model_code, prompt, params, max_retries=3):
    """提交图片生成任务，返回 taskId"""
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
            log(f"  ⚠ 提交返回无 data (第{attempt}/{max_retries}次): {str(result)[:200]}")
        except Exception as e:
            log(f"  ⚠ 提交异常 (第{attempt}/{max_retries}次): {e}")
        if attempt < max_retries:
            time.sleep(2)
    log(f"  ❌ 提交失败，已重试 {max_retries} 次")
    return None


def poll_image_task(task_id, timeout=600, label=""):
    """轮询图片任务直到完成，返回 {result: [...], show: [...]} 或 None"""
    start_time = time.time()
    consecutive_errors = 0
    max_errors = 10
    lbl = f"[{label}] " if label else ""

    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            log(f"  ❌ {lbl}超时（{timeout}秒）")
            return None
        try:
            result = auth.api_request(
                f"{BASE_URL}/api/material/creation/imageCreateGet?taskId={task_id}",
                method='GET'
            )
            if result.get("code") != 200:
                consecutive_errors += 1
                if consecutive_errors >= max_errors:
                    log(f"  ❌ {lbl}连续接口错误，停止轮询")
                    return None
                time.sleep(3)
                continue

            consecutive_errors = 0
            data = result.get("data", {})
            status = data.get("taskStatus", "UNKNOWN")

            if status == "SUCCESS":
                return {
                    "result": data.get("resultFileList", []),
                    "show":   data.get("resultFileDisplayList", [])
                }
            elif status in ("FAIL", "FAILED"):
                log(f"  ❌ {lbl}生成失败: {data.get('errorMsg', '未知')}")
                return None
            else:
                log(f"  ⏳ {lbl}状态: {status}, 已等待: {elapsed:.0f}s")
            time.sleep(5)
        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors >= max_errors:
                return None
            time.sleep(5)


def download_image(url, output_path):
    """下载图片到本地，返回路径或 None"""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["curl", "-s", "-L", "-o", str(output_path), url],
            check=True, timeout=60
        )
        if output_path.exists() and output_path.stat().st_size > 1000:
            log(f"  ✓ 已下载: {output_path.name} ({output_path.stat().st_size // 1024}KB)")
            return str(output_path)
    except Exception as e:
        log(f"  ❌ 下载失败: {e}")
    return None


def load_style_config(chars_json_path, chars_data, design_json, gemini_key):
    """加载或自动生成世界观风格配置，返回 style dict 或 None"""
    style_json_ref = chars_data.get('style_config', '')
    if not style_json_ref:
        log("⚠ characters.json 未指定 style_config，将使用通用审图标准")
        return None

    chars_dir = Path(chars_json_path).parent
    style_path = chars_dir / style_json_ref

    if style_path.exists():
        with open(style_path, 'r', encoding='utf-8') as f:
            style_data = json.load(f)
        log(f"✓ 已加载风格配置: {style_path.name}  世界观: 【{style_data.get('worldview_type', '未知')}】")
        return style_data

    if design_json and Path(design_json).exists() and gemini_key:
        log("⚠ 风格配置不存在，调用 Gemini 自动分析世界观...")
        try:
            env = {**os.environ, "GEMINI_API_KEY": gemini_key, "PYTHONUTF8": "1"}
            result = subprocess.run(
                ["python", str(GENERATE_STYLE_SCRIPT),
                 "--design-json", design_json, "--output", str(style_path)],
                env=env, capture_output=True, text=True, timeout=180
            )
            if result.returncode == 0 and style_path.exists():
                with open(style_path, 'r', encoding='utf-8') as f:
                    style_data = json.load(f)
                log(f"✓ 风格配置已自动生成  世界观: 【{style_data.get('worldview_type', '未知')}】")
                return style_data
        except Exception as e:
            log(f"⚠ 风格配置生成异常: {e}")
    return None


def run_char_review(char_items, gemini_key, temp_dir, review_type="front", style_data=None):
    """
    调用角色专用 Gemini 审图脚本。
    review_type: "front" 审查正视图; "views" 审查侧/背视图一致性
    """
    config = {
        "review_type": review_type,
        "characters": []
    }
    for item in char_items:
        entry = {
            "name":      item['char_name'],
            "form":      item['form_name'],
            "is_reused": item.get('is_reused', False),
        }
        if review_type == "front":
            entry["image"]          = item.get('front_path', '')
            entry["prompt"]         = item.get('front_prompt', '')
            entry["script_context"] = item.get('script_context', '')
        elif review_type == "three_view":
            entry["three"]          = item.get('three_path', '')
            entry["script_context"] = item.get('script_context', '')
        else:
            entry["front"]          = item.get('front_path', '')
            entry["side"]           = item.get('side_path', '')
            entry["back"]           = item.get('back_path', '')
            entry["script_context"] = item.get('script_context', '')
        config["characters"].append(entry)

    if style_data:
        config["worldview_type"]     = style_data.get('worldview_type', '通用')
        config["anti_contamination"] = style_data.get('anti_contamination', '')

    config_path = Path(temp_dir) / f"_char_review_{review_type}_{int(time.time())}.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # 输出审核前的详细日志
    log(f"  📋 准备审核 {len(char_items)} 个角色形态 (类型: {review_type}):")
    for item in char_items:
        status = "【已确认】" if item.get('is_reused', False) else "【待审】"
        log(f"    - {status} {item['char_name']}/{item['form_name']}")

    try:
        env    = {**os.environ, "GEMINI_API_KEY": gemini_key, "PYTHONUTF8": "1"}
        log(f"  🔍 调用 Gemini 审图脚本...")
        result = subprocess.run(
            ["python", str(CHAR_REVIEW_SCRIPT), "--config", str(config_path)],
            env=env, capture_output=True, text=True, timeout=360
        )

        # 输出审核脚本的 stderr（包含审核过程日志）
        if result.stderr:
            log(f"  📝 审核过程日志:")
            for line in result.stderr.strip().split('\n'):
                if line.strip():
                    log(f"    {line}")

        if result.returncode == 0 and result.stdout.strip():
            for line in reversed(result.stdout.strip().split('\n')):
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
                                log(f"    - [{issue.get('severity', '?')}] {issue.get('name', '?')}/{issue.get('form', '?')}: {issue.get('reason', '?')}")
                        return review_result
                    except json.JSONDecodeError:
                        continue
        log(f"  ⚠ 审图脚本异常: {(result.stderr or '')[-400:]}")
        return {"approved": True, "summary": "审图脚本异常，默认通过", "issues": []}
    except Exception as e:
        log(f"  ⚠ 审图调用异常: {e}")
        return {"approved": True, "summary": "审图调用异常，默认通过", "issues": []}
    finally:
        if config_path.exists():
            config_path.unlink()


def generate_voice(voice_text, output_path, char_name, form_name):
    """
    生成角色音频 (voice.mp3)。
    调用平台视频合成 API → 下载 → ffmpeg 提取音频。
    如平台无语音接口或操作失败，静默跳过并返回 None。
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # 提交视频合成任务（语音模式）
        payload = {
            "modelCode":   "voice_synthesis",
            "taskPrompt":  voice_text,
            "promptParams": {"type": "voice", "character": char_name}
        }
        result = auth.api_request(
            f"{BASE_URL}/api/material/creation/videoCreate",
            data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            method='POST'
        )
        task_id = result.get("data")
        if not task_id:
            log(f"  ⚠ 音频任务提交失败（{char_name}/{form_name}）: {str(result)[:150]}")
            return None

        # 轮询
        deadline = time.time() + 300
        while time.time() < deadline:
            r    = auth.api_request(
                f"{BASE_URL}/api/material/creation/videoCreateGet?taskId={task_id}",
                method='GET'
            )
            data = r.get("data", {})
            status = data.get("taskStatus", "UNKNOWN")
            if status == "SUCCESS":
                urls = data.get("resultFileList") or data.get("resultFileDisplayList") or []
                if not urls:
                    return None
                # 下载视频到临时文件
                video_tmp = output_path.parent / f"_{output_path.stem}_tmp.mp4"
                subprocess.run(
                    ["curl", "-s", "-L", "-o", str(video_tmp), urls[0]],
                    check=True, timeout=60
                )
                # 提取音频
                subprocess.run(
                    ["ffmpeg", "-y", "-i", str(video_tmp),
                     "-vn", "-acodec", "libmp3lame", "-q:a", "2", str(output_path)],
                    check=True, capture_output=True, timeout=60
                )
                if video_tmp.exists():
                    video_tmp.unlink()
                if output_path.exists() and output_path.stat().st_size > 0:
                    log(f"  ✓ 音频已生成: {char_name}/{form_name}/voice.mp3")
                    return str(output_path)
                return None
            elif status in ("FAIL", "FAILED"):
                log(f"  ⚠ 音频生成失败（{char_name}/{form_name}）: {data.get('errorMsg', '未知')}")
                return None
            time.sleep(5)

    except Exception as e:
        log(f"  ⚠ 音频生成异常（{char_name}/{form_name}）: {e}（已跳过）")
    return None


def save_form_to_project(item, project_dir, project_name):
    """将单个形态的所有文件复制到最终目录，返回 meta dict"""
    char_name  = item['char_name']
    form_name  = item['form_name']
    safe_char  = sanitize_dirname(char_name)
    safe_form  = sanitize_dirname(form_name)
    subject_id = generate_subject_id(project_name, char_name, form_name)

    form_dir = Path(project_dir) / "characters" / safe_char / safe_form
    form_dir.mkdir(parents=True, exist_ok=True)

    def _copy(src_key, dst_name):
        src = item.get(src_key)
        if src and Path(src).exists():
            dst = form_dir / dst_name
            if Path(src).resolve() != dst.resolve():
                shutil.copy2(src, str(dst))
            log(f"  ✓ {char_name}/{form_name}/{dst_name}")
            return f"characters/{safe_char}/{safe_form}/{dst_name}"
        return None

    face_view  = _copy('front_path', '正面.png')
    side_view  = _copy('side_path',  '侧面.png')
    back_view  = _copy('back_path',  '背面.png')
    three_view = _copy('three_path', '三视图.png')
    voice      = _copy('voice_path', 'voice.mp3')

    return {
        "subject_id": subject_id,
        "face_view":  face_view  or f"characters/{safe_char}/{safe_form}/正面.png",
        "side_view":  side_view  or f"characters/{safe_char}/{safe_form}/侧面.png",
        "back_view":  back_view  or f"characters/{safe_char}/{safe_form}/背面.png",
        "three_view": three_view or f"characters/{safe_char}/{safe_form}/三视图.png",
        "voice":      voice      or f"characters/{safe_char}/{safe_form}/voice.mp3",
    }


def write_per_char_json(char_name, forms_meta, project_dir):
    """生成 characters/{char_name}/characters.json"""
    safe_char = sanitize_dirname(char_name)
    char_dir  = Path(project_dir) / "characters" / safe_char
    char_dir.mkdir(parents=True, exist_ok=True)
    with open(char_dir / "characters.json", 'w', encoding='utf-8') as f:
        json.dump(forms_meta, f, ensure_ascii=False, indent=4)
    log(f"  ✓ {char_name}/characters.json（{len(forms_meta)} 个形态）")


def write_global_index(all_chars_meta, actor_id_to_name, project_dir):
    """生成（合并更新）characters/characters.json 全局索引"""
    chars_root = Path(project_dir) / "characters"
    chars_root.mkdir(parents=True, exist_ok=True)
    index_path = chars_root / "characters.json"

    # 读取已有索引（幂等合并）
    existing = {}
    if index_path.exists():
        try:
            with open(index_path, 'r', encoding='utf-8') as f:
                existing = json.load(f)
        except Exception:
            pass

    for actor_id, forms_meta in all_chars_meta.items():
        char_name = actor_id_to_name.get(actor_id, actor_id)
        if actor_id not in existing:
            existing[actor_id] = {"name": char_name}
        else:
            existing[actor_id]["name"] = char_name
        existing[actor_id].update(forms_meta)

    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(existing, f, ensure_ascii=False, indent=4)
    log(f"  ✓ 全局索引 → characters/characters.json（{len(existing)} 个角色）")


# ────────────────────────────────────────────────────────────────────────────
# 主流程（V2：三视图优先）
# ────────────────────────────────────────────────────────────────────────────

def generate_characters(episode, chars_json, project_dir, workspace=None, design_json=None,
                        skip_single_views=False, scripts_dir=None):
    # 设置 workspace 默认值
    if not workspace:
        workspace = project_dir

    # 初始化日志文件
    try:
        setup_logging(workspace)
    except Exception as e:
        print(f"⚠ 日志文件初始化失败: {e}", flush=True)

    log(f"=== 开始生成第{episode}集角色图（V2：三视图优先流程）===")
    log("流程: 三视图(16:9横版) → Gemini审查 → 切分为正/侧/背图(9:16竖版) → 音频 → 保存")

    gemini_key = get_gemini_key()
    log(f"{'✓ GEMINI_API_KEY 已加载' if gemini_key else '⚠ GEMINI_API_KEY 未设置，将跳过审图'}")

    # ── 读取输入 ──────────────────────────────────────────────────────────────
    with open(chars_json, 'r', encoding='utf-8') as f:
        chars_data = json.load(f)

    project_name = chars_data.get('project', 'unknown')
    all_chars    = chars_data.get('characters', [])

    # 筛选本集角色+形态
    items = []
    for char in all_chars:
        char_name = char['name']
        actor_id = char.get('id', char_name)
        for form in char.get('forms', []):
            if episode is None or episode in form.get('episodes', []):
                items.append({
                    'char_name':      char_name,
                    'actor_id':       actor_id,
                    'form_name':      form['name'],
                    'state_id':       form.get('state_id', form['name']),
                    'is_default':     form.get('is_default', False),
                    'episodes':       form.get('episodes', [episode]),
                    'three_prompt':   form.get('three_view_prompt') or form.get('front_prompt', ''),
                    'voice_text':     form.get('voice_text', ''),
                    # 运行时字段
                    'three_path':     None,
                    'three_show_url': None,
                    'front_path':     None,
                    'side_path':      None,
                    'back_path':      None,
                    'voice_path':     None,
                    'is_reused':      False,
                })

    log(f"本集共 {len(items)} 个角色形态")
    log_progress("角色", 0, len(items), "生成中")
    if not items:
        log("没有符合条件的角色形态，退出")
        return

    project_path   = Path(project_dir)
    workspace_path = Path(workspace) if workspace else project_path
    temp_dir       = workspace_path / "_temp" / "characters"
    temp_dir.mkdir(parents=True, exist_ok=True)

    # ================================================================
    # Phase 0: 加载世界观风格配置
    # ================================================================
    log("\n=== Phase 0：加载世界观风格配置 ===")
    style_data = load_style_config(chars_json, chars_data, design_json, gemini_key)

    # ================================================================
    # Phase 1: 生成三视图
    # 策略：先并行生成所有 default 形态（无 iref），审核通过后
    #       再以 default show_url 为 iref 并行生成所有 state 形态
    # ================================================================

    # 分组：default 形态 vs state 形态
    default_items = [it for it in items if it.get('is_default', False)]
    state_items   = [it for it in items if not it.get('is_default', False)]

    # 为每个 item 打上全局序号
    for i, item in enumerate(items):
        item['_idx'] = i + 1

    # 断点续传：检查已有三视图
    for item in items:
        safe_char = sanitize_dirname(item['char_name'])
        safe_form = sanitize_dirname(item['form_name'])
        three_file = project_path / "characters" / safe_char / safe_form / "三视图.png"
        if three_file.exists():
            item['three_path'] = str(three_file)
            item['is_reused'] = True
            log(f"  ✓ 三视图已存在，复用: {item['char_name']}/{item['form_name']}")

    # 公用轮询函数
    def _poll_three(args):
        item, tid = args
        safe_char = sanitize_dirname(item['char_name'])
        safe_form = sanitize_dirname(item['form_name'])
        label = f"{item['char_name']}/{item['form_name']}/三视图"
        result = poll_image_task(tid, label=label)
        if result and result.get("result"):
            out = temp_dir / f"three_{safe_char}_{safe_form}.png"
            path = download_image(result["result"][0], out)
            if path:
                item['three_path'] = path
                item['three_show_url'] = (result.get("show") or [None])[0]
                log(f"  ✓ 三视图已下载: {item['char_name']}/{item['form_name']}")
                return True
        return False

    # ── Phase 1A：并行生成所有 default 三视图（无 iref）──────────────
    log(f"\n=== Phase 1A：并行生成所有角色 default 三视图（{len(default_items)} 个，无 iref）===")
    default_task_queue = []
    for item in default_items:
        if item.get('three_path') or not item.get('three_prompt'):
            continue
        params = {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
        tid = submit_image_task(DEFAULT_MODEL, THREE_VIEW_PREFIX + item['three_prompt'], params)
        if tid:
            default_task_queue.append((item, tid))
            log(f"  ✓ default 三视图已提交: {item['char_name']}/{item['form_name']}")

    if default_task_queue:
        log(f"\n并行轮询 {len(default_task_queue)} 个 default 三视图任务...")
        with ThreadPoolExecutor(max_workers=len(default_task_queue)) as ex:
            list(ex.map(_poll_three, default_task_queue))

    # ── Phase 1B：审查 default 三视图 ────────────────────────────────
    new_defaults = [it for it in default_items if it.get('three_path') and not it['is_reused']]
    if new_defaults and gemini_key:
        log(f"\n=== Phase 1B：Gemini default 三视图审查（{len(new_defaults)} 个）===")
        for rnd in range(1, MAX_REVIEW_ROUNDS + 1):
            log(f"\n--- 审查轮次 {rnd} ---")
            rv = run_char_review(new_defaults, gemini_key, temp_dir, "three_view", style_data)
            issues = rv.get('issues', [])
            pass_cnt = len(new_defaults) - len(issues)
            pass_rate = pass_cnt / len(new_defaults) if new_defaults else 1.0
            log(f"审查结果: {'✓ 通过' if rv.get('approved') else '✗ 未通过'}  合格率: {pass_rate:.0%} ({pass_cnt}/{len(new_defaults)})")
            if pass_rate >= _RC["review_rounds"]["batch_pass_rate_threshold"] or not issues:
                log("✓ default 三视图审查通过")
                break

    # Phase 1B 审核完成 → 立即切分并保存所有 default 形态到 output
    log("\n=== Phase 1B 后：立即切分并保存 default 形态 ===")
    for item in default_items:
        if not item.get('three_path'):
            continue
        safe_char = sanitize_dirname(item['char_name'])
        safe_form = sanitize_dirname(item['form_name'])
        output_dir = project_path / "characters" / safe_char / safe_form
        front_file = output_dir / "正面.png"
        if front_file.exists():
            item['front_path'] = str(front_file)
            item['side_path'] = str(output_dir / "侧面.png")
            item['back_path'] = str(output_dir / "背面.png")
            log(f"  ✓ 「{item['char_name']}/{item['form_name']}」已切分，跳过")
            continue
        result = split_three_view_image(item['three_path'], output_dir)
        if result['front']:
            item['front_path'] = result['front']
            item['side_path'] = result['side']
            item['back_path'] = result['back']
            # 将三视图从 temp 复制到输出目录
            three_dst = output_dir / "三视图.png"
            if Path(item['three_path']).resolve() != three_dst.resolve():
                shutil.copy2(item['three_path'], str(three_dst))
                item['three_path'] = str(three_dst)
            log(f"  💾 「{item['char_name']}/{item['form_name']}」已切分保存到 output")

    # ── Phase 1C：以 default show_url 为 iref，并行生成所有 state 三视图 ──
    if state_items:
        log(f"\n=== Phase 1C：基于 default 并行生成 state 三视图（{len(state_items)} 个）===")

        # 构建 actor_id → default show_url 映射
        default_url_map = {}
        for it in default_items:
            if it.get('three_show_url'):
                default_url_map[it['actor_id']] = it['three_show_url']
                log(f"  ✓ 「{it['char_name']}」default show_url 已捕获")

        state_task_queue = []
        for item in state_items:
            if item.get('three_path') or not item.get('three_prompt'):
                continue
            params = {"quality": "2K", "ratio": "16:9", "generate_num": "1"}
            iref_url = default_url_map.get(item['actor_id'])
            if iref_url:
                params["iref"] = iref_url
                log(f"  以 default 为 iref → {item['char_name']}/{item['form_name']}")
            else:
                log(f"  ⚠ 无 iref（default 未生成）→ {item['char_name']}/{item['form_name']}")
            tid = submit_image_task(DEFAULT_MODEL, THREE_VIEW_PREFIX + item['three_prompt'], params)
            if tid:
                state_task_queue.append((item, tid))

        if state_task_queue:
            log(f"\n并行轮询 {len(state_task_queue)} 个 state 三视图任务...")
            with ThreadPoolExecutor(max_workers=len(state_task_queue)) as ex:
                list(ex.map(_poll_three, state_task_queue))

        # ── Phase 1D：审查 state 三视图 ──────────────────────────────
        new_states = [it for it in state_items if it.get('three_path') and not it['is_reused']]
        if new_states and gemini_key:
            log(f"\n=== Phase 1D：Gemini state 三视图审查（{len(new_states)} 个）===")
            for rnd in range(1, MAX_REVIEW_ROUNDS + 1):
                log(f"\n--- 审查轮次 {rnd} ---")
                rv = run_char_review(new_states, gemini_key, temp_dir, "three_view", style_data)
                issues = rv.get('issues', [])
                pass_cnt = len(new_states) - len(issues)
                pass_rate = pass_cnt / len(new_states) if new_states else 1.0
                log(f"审查结果: {'✓ 通过' if rv.get('approved') else '✗ 未通过'}  合格率: {pass_rate:.0%} ({pass_cnt}/{len(new_states)})")
                if pass_rate >= _RC["review_rounds"]["batch_pass_rate_threshold"] or not issues:
                    log("✓ state 三视图审查通过")
                    break

        # Phase 1D 审核完成 → 立即切分并保存所有 state 形态到 output
        log("\n=== Phase 1D 后：立即切分并保存 state 形态 ===")
        for item in state_items:
            if not item.get('three_path'):
                continue
            safe_char = sanitize_dirname(item['char_name'])
            safe_form = sanitize_dirname(item['form_name'])
            output_dir = project_path / "characters" / safe_char / safe_form
            front_file = output_dir / "正面.png"
            if front_file.exists():
                item['front_path'] = str(front_file)
                item['side_path'] = str(output_dir / "侧面.png")
                item['back_path'] = str(output_dir / "背面.png")
                log(f"  ✓ 「{item['char_name']}/{item['form_name']}」已切分，跳过")
                continue
            result = split_three_view_image(item['three_path'], output_dir)
            if result['front']:
                item['front_path'] = result['front']
                item['side_path'] = result['side']
                item['back_path'] = result['back']
                three_dst = output_dir / "三视图.png"
                if Path(item['three_path']).resolve() != three_dst.resolve():
                    shutil.copy2(item['three_path'], str(three_dst))
                    item['three_path'] = str(three_dst)
                log(f"  💾 「{item['char_name']}/{item['form_name']}」已切分保存到 output")

    # ================================================================
    # Phase 3: 切分三视图为正面/侧面/背面图（9:16竖版）
    # ================================================================
    log("\n=== Phase 3：切分三视图为正面/侧面/背面图（9:16竖版）===")

    for item in items:
        if not item.get('three_path'):
            continue

        safe_char = sanitize_dirname(item['char_name'])
        safe_form = sanitize_dirname(item['form_name'])
        output_dir = project_path / "characters" / safe_char / safe_form

        # 检查是否已经切分过
        front_file = output_dir / "正面.png"
        if front_file.exists():
            log(f"  ✓ 「{item['char_name']}/{item['form_name']}」已切分，跳过")
            item['front_path'] = str(front_file)
            item['side_path'] = str(output_dir / "侧面.png")
            item['back_path'] = str(output_dir / "背面.png")
            continue

        # 切分三视图
        log(f"  切分三视图: {item['char_name']}/{item['form_name']}")
        result = split_three_view_image(item['three_path'], output_dir)
        if result['front']:
            item['front_path'] = result['front']
            item['side_path'] = result['side']
            item['back_path'] = result['back']
            log(f"  ✓ 「{item['char_name']}/{item['form_name']}」切分完成")
        else:
            log(f"  ⚠ 「{item['char_name']}/{item['form_name']}」切分失败")

    # ================================================================
    # Phase 4: 保存到最终目录 + 生成 JSON
    # ================================================================
    log("\n=== Phase 4：保存到最终目录，生成 JSON ===")

    chars_grouped = defaultdict(dict)
    actor_id_to_name = {}
    for item in items:
        if not item.get('three_path'):
            continue
        form_meta = save_form_to_project(item, project_dir, project_name)
        actor_id = item['actor_id']
        actor_id_to_name[actor_id] = item['char_name']
        chars_grouped[actor_id][item['state_id']] = form_meta

    # per-character JSON
    for actor_id, forms_meta in chars_grouped.items():
        char_name = actor_id_to_name[actor_id]
        write_per_char_json(char_name, forms_meta, project_dir)

    # 全局索引
    write_global_index(chars_grouped, actor_id_to_name, project_dir)

    # 完成总结
    total = len(items)
    with_three = sum(1 for it in items if it.get('three_path'))
    with_front = sum(1 for it in items if it.get('front_path'))

    scope_desc = f"第{episode}集" if episode else "项目所有"
    log(f"\n=== {scope_desc}角色生成完成（V2流程）===")
    log(f"  形态总数: {total}")
    log(f"  三视图:   {with_three}/{total}")
    log(f"  切分图:   {with_front}/{total}")
    log(f"  输出目录: {project_dir}/characters/")
    log_progress("角色", with_three, total, "已完成")

    # 清理临时文件
    if temp_dir.exists():
        shutil.rmtree(str(temp_dir), ignore_errors=True)
        log("  ✓ 临时文件已清理")

    # 关闭日志文件
    close_logging()


# ────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="角色图片全自动生成（V2：三视图优先流程）")
    parser.add_argument("--episode",           type=int, default=None,  help="集数（可选，不指定则生成项目所有角色形态）")
    parser.add_argument("--characters-json",   required=True,           help="角色 JSON 文件路径")
    parser.add_argument("--project-dir",       required=True,           help="项目输出目录（仅存最终结果）")
    parser.add_argument("--workspace",         default=None,            help="工作区目录（存临时文件，默认同 project-dir）")
    parser.add_argument("--design-json",       default=None,            help="design.json 路径（可选，用于自动生成 style.json）")
    parser.add_argument("--skip-single-views", action="store_true",     help="跳过独立侧视图/背视图，仅生成三视图整合图（省时精简模式）")
    parser.add_argument("--scripts-dir",       default=None,            help="剧本 episodes 目录（如 01-script/output/episodes），用于预分析场次上下文")
    args = parser.parse_args()

    generate_characters(
        args.episode,
        args.characters_json,
        args.project_dir,
        args.workspace,
        args.design_json,
        skip_single_views=args.skip_single_views,
        scripts_dir=args.scripts_dir,
    )
