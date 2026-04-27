"""
视频分析：调用 Gemini 分析视频，输出片段 JSON
用法：python analyze_video.py <视频文件路径>
输出：output/gemini-v2t-<视频名>-<时间戳>.json

Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
This path uploads video files to Gemini via the Files API and runs video-to-text
analysis. aos-cli model v1 has no contract for video upload/processing, so this
remains on the direct SDK pending protocol expansion.
"""

import os
import sys
import json
import time
import subprocess
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# 配置加载优先级：环境变量 > CWD/.env > skill 内置 default.env
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_ENV = SKILL_DIR / "assets" / "default.env"

# 先加载 skill 内置默认值（不覆盖已有环境变量）
if DEFAULT_ENV.exists():
    load_dotenv(DEFAULT_ENV, override=False)
# 再加载用户 CWD 下的 .env（不覆盖已有环境变量）
load_dotenv(override=False)

PROMPT_PATH = SKILL_DIR / "assets" / "video_analysis.txt"
OUTPUT_DIR = Path.cwd() / "output"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://api.chatfire.cn/gemini")

# Gemini 参数
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
GEMINI_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "1.0"))
GEMINI_THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "low")
_res = os.getenv("GEMINI_MEDIA_RESOLUTION", "medium")
GEMINI_MEDIA_RESOLUTION = f"MEDIA_RESOLUTION_{_res.upper()}"

# 视频压缩参数
COMPRESS_ENABLED = os.getenv("COMPRESS_BEFORE_UPLOAD", "true").lower() in ("true", "1", "yes")
COMPRESS_RESOLUTION = int(os.getenv("COMPRESS_RESOLUTION", "720"))
COMPRESS_FPS = int(os.getenv("COMPRESS_FPS", "12"))
COMPRESS_CRF = int(os.getenv("COMPRESS_CRF", "28"))
COMPRESS_SKIP_UNDER_MB = int(os.getenv("COMPRESS_SKIP_UNDER_MB", "100"))


def parse_time(t: str) -> float:
    """将 MM:SS 或 HH:MM:SS 格式转为秒数"""
    parts = t.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    return float(t)


def compress_video(video_path: str) -> str | None:
    """上传前压缩视频以节省带宽。返回压缩文件路径，跳过时返回 None"""
    size_mb = Path(video_path).stat().st_size / (1024 * 1024)

    if not COMPRESS_ENABLED:
        print(f"视频压缩已禁用，直接上传 ({size_mb:.1f} MB)")
        return None

    if size_mb < COMPRESS_SKIP_UNDER_MB:
        print(f"文件较小 ({size_mb:.1f} MB < {COMPRESS_SKIP_UNDER_MB} MB)，跳过压缩")
        return None

    if shutil.which("ffmpeg") is None:
        print("⚠️ 未找到 ffmpeg，跳过压缩")
        return None

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out_path = tmp.name
    tmp.close()

    cmd = [
        "ffmpeg", "-y", "-loglevel", "warning",
        "-i", video_path,
        "-vf", f"scale=-2:{COMPRESS_RESOLUTION}",
        "-r", str(COMPRESS_FPS),
        "-c:v", "libx264", "-crf", str(COMPRESS_CRF),
        "-c:a", "aac", "-b:a", "64k", "-ac", "1",
        "-preset", "fast", "-movflags", "+faststart",
        out_path,
    ]

    print(f"正在压缩视频 ({size_mb:.1f} MB → {COMPRESS_RESOLUTION}p/{COMPRESS_FPS}fps)...")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode != 0:
        print(f"⚠️ 压缩失败，使用原始文件\n  {proc.stderr.strip()[-200:]}")
        Path(out_path).unlink(missing_ok=True)
        return None

    out_mb = Path(out_path).stat().st_size / (1024 * 1024)
    elapsed = time.time() - t0
    print(f"✓ 压缩完成: {size_mb:.1f} MB → {out_mb:.1f} MB ({elapsed:.1f}s, {size_mb / out_mb:.1f}x)")
    return out_path


def upload_video(video_path: str, client):
    """上传本地视频到 Gemini Files API"""
    print(f"正在上传视频: {video_path}")
    video_file = client.files.upload(file=video_path)

    # 等待文件处理完成
    print("等待 Gemini 处理视频...")
    while video_file.state.name == "PROCESSING":
        time.sleep(3)
        video_file = client.files.get(name=video_file.name)
        print(f"  状态: {video_file.state.name}")

    if video_file.state.name != "ACTIVE":
        raise RuntimeError(f"视频处理失败，状态: {video_file.state.name}")

    print(f"✓ 视频上传完成: {video_file.name}")
    return video_file


def analyze_with_gemini(video_file, video_stem: str, client) -> list[dict]:
    """调用 Gemini 分析视频，返回片段列表，并将原始输出保存到 output/"""
    from google.genai import types

    prompt = PROMPT_PATH.read_text(encoding="utf-8")

    config = types.GenerateContentConfig(
        temperature=GEMINI_TEMPERATURE,
        thinking_config=types.ThinkingConfig(thinking_level=GEMINI_THINKING_LEVEL),
        media_resolution=GEMINI_MEDIA_RESOLUTION,
    )

    print(f"正在调用 Gemini 分析视频（模型: {GEMINI_MODEL}，thinking: {GEMINI_THINKING_LEVEL}，resolution: {GEMINI_MEDIA_RESOLUTION}）...")
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[video_file, prompt],
        config=config,
    )

    raw = response.text.strip()

    # 保存原始输出到 output/
    OUTPUT_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    save_path = OUTPUT_DIR / f"gemini-v2t-{video_stem}-{ts}.json"
    save_path.write_text(raw, encoding="utf-8")
    print(f"✓ Gemini 原始输出已保存: {save_path.name}")

    # 清理可能的 markdown 代码块包裹
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]

    segments = json.loads(raw)
    print(f"✓ Gemini 识别出 {len(segments)} 个片段")
    return segments


def main():
    if len(sys.argv) < 2:
        print("用法: python analyze_video.py <视频文件路径>")
        sys.exit(1)

    video_path = sys.argv[1]
    if not Path(video_path).exists():
        raise FileNotFoundError(f"找不到视频文件: {video_path}")

    video_stem = Path(video_path).stem

    if not GEMINI_API_KEY:
        raise EnvironmentError("请在 .env 中设置 GEMINI_API_KEY（值使用 ChatFire key）")

    # 1. 初始化 Gemini 客户端并上传视频
    from google import genai as google_genai
    from google.genai import types as genai_types
    client = google_genai.Client(
        api_key=GEMINI_API_KEY,
        http_options=genai_types.HttpOptions(base_url=GEMINI_BASE_URL),
    )

    compressed = compress_video(video_path)
    upload_path = compressed or video_path
    video_file = upload_video(upload_path, client)
    if compressed:
        Path(compressed).unlink(missing_ok=True)

    segments = analyze_with_gemini(video_file, video_stem, client)

    # 2. 为每个片段计算 duration_seconds
    for seg in segments:
        start_sec = parse_time(seg["start"])
        end_sec = parse_time(seg["end"])
        seg["duration_seconds"] = round(end_sec - start_sec, 2)

    # 3. 打印分段结果
    print("\n--- 分段结果 ---")
    for seg in segments:
        needs = "🎵 需要配乐" if seg.get("needs_music") else "🔇 静音"
        dur = seg["duration_seconds"]
        print(f"  片段{seg['segment_id']} ({seg['start']}-{seg['end']}, {dur}s): {needs}")
        if seg.get("needs_music"):
            print(f"    情绪: {seg.get('情绪', '')}")

    # 4. 保存最终 JSON（与 Gemini 原始输出分开，包含 duration_seconds）
    OUTPUT_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    output_path = OUTPUT_DIR / f"segments-{video_stem}-{ts}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(segments, f, ensure_ascii=False, indent=2)

    music_count = sum(1 for s in segments if s.get("needs_music"))
    print(f"\n✓ 已保存 {len(segments)} 个片段（{music_count} 个需要配乐）到: {output_path}")
    print(f"\n📋 下一步：将此 JSON 文件发给 MCP 音乐匹配服务进行选曲")


if __name__ == "__main__":
    main()
