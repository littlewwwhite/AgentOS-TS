"""
视频分析：调用 aos-cli model 分析视频，输出片段 JSON
用法：python analyze_video.py <视频文件路径>
输出：output/segments-<视频名>-<时间戳>.json

Model boundary note: migrated to aos-cli model video.analyze.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# 配置加载优先级：环境变量 > CWD/.env > skill 内置 default.env
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_ENV = SKILL_DIR / "assets" / "default.env"

if load_dotenv is not None:
    # 先加载 skill 内置默认值（不覆盖已有环境变量）
    if DEFAULT_ENV.exists():
        load_dotenv(DEFAULT_ENV, override=False)
    # 再加载用户 CWD 下的 .env（不覆盖已有环境变量）
    load_dotenv(override=False)

PROMPT_PATH = SKILL_DIR / "assets" / "video_analysis.txt"
OUTPUT_DIR = Path.cwd() / "output"

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


# aos-cli model 参数
VIDEO_ANALYZE_MODEL = os.getenv("VIDEO_ANALYZE_MODEL", "gemini-3.1-pro-preview")
VIDEO_ANALYZE_TEMPERATURE = float(os.getenv("VIDEO_ANALYZE_TEMPERATURE", "1.0"))
VIDEO_ANALYZE_THINKING_LEVEL = os.getenv("VIDEO_ANALYZE_THINKING_LEVEL", "low")
_res = os.getenv("VIDEO_ANALYZE_MEDIA_RESOLUTION", "medium")
VIDEO_ANALYZE_MEDIA_RESOLUTION = f"MEDIA_RESOLUTION_{_res.upper()}"

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


def analyze_with_aos_cli(
    video_path: str,
    video_stem: str,
    *,
    output_dir: Path = OUTPUT_DIR,
    cwd: Path | None = None,
) -> list[dict[str, Any]]:
    """调用 aos-cli video.analyze 分析视频，返回带 duration_seconds 的片段列表。"""
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    compressed = compress_video(video_path)
    analysis_path = Path(compressed or video_path)
    try:
        result = _run_video_analyze(
            analysis_path,
            prompt,
            video_stem=video_stem,
            cwd=cwd or Path.cwd(),
            output_dir=output_dir,
        )
    finally:
        if compressed:
            Path(compressed).unlink(missing_ok=True)

    segments = _segments_from_response(result)
    _add_duration_seconds(segments)
    print(f"✓ aos-cli video.analyze 识别出 {len(segments)} 个片段")
    return segments


def _run_video_analyze(
    video_path: Path,
    prompt: str,
    *,
    video_stem: str,
    cwd: Path,
    output_dir: Path,
) -> object:
    request = _build_request(video_path, prompt)
    with tempfile.TemporaryDirectory(prefix="music-matcher-analyze-aos-cli-") as tmp:
        tmp_dir = Path(tmp)
        request_path = tmp_dir / "request.json"
        response_path = tmp_dir / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")

        print(
            "正在调用 aos-cli video.analyze 分析视频"
            f"（模型: {VIDEO_ANALYZE_MODEL}，thinking: {VIDEO_ANALYZE_THINKING_LEVEL}，"
            f"resolution: {VIDEO_ANALYZE_MEDIA_RESOLUTION}）..."
        )
        completed = aos_cli_model_run(request_path, response_path, cwd=cwd)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        if not response_path.exists():
            raise RuntimeError("aos-cli did not write a video analysis response envelope")

        output_dir.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%m%d%H%M")
        raw_path = output_dir / f"aos-cli-video-analyze-raw-{video_stem}-{ts}.json"
        raw_path.write_text(response_path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"✓ aos-cli 原始响应已保存: {raw_path.name}")

        return _read_json_output(response_path)


def _build_request(video_path: Path, prompt: str) -> dict[str, Any]:
    if not video_path.exists():
        raise FileNotFoundError(f"找不到视频文件: {video_path}")
    return {
        "apiVersion": "aos-cli.model/v1",
        "task": "music-matcher.analyze-video",
        "capability": "video.analyze",
        "modelPolicy": {"model": VIDEO_ANALYZE_MODEL},
        "input": {"content": {"prompt": prompt, "videos": [video_path.resolve().as_uri()]}},
        "output": {"kind": "json"},
        "options": {
            "temperature": VIDEO_ANALYZE_TEMPERATURE,
            "thinkingLevel": VIDEO_ANALYZE_THINKING_LEVEL,
            "mediaResolution": VIDEO_ANALYZE_MEDIA_RESOLUTION,
        },
    }


def _read_json_output(response_path: Path) -> object:
    try:
        response = json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli video analysis response envelope: {response_path}") from exc

    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message") or "aos-cli video analysis failed")

    output = response.get("output") or {}
    if output.get("kind") != "json":
        raise RuntimeError(f"aos-cli response output.kind mismatch: expected json, got {output.get('kind')}")
    if "data" in output:
        return output["data"]
    if "text" in output:
        return _parse_json_text(str(output["text"]))
    raise RuntimeError("aos-cli video analysis response missing output.data")


def _parse_json_text(raw: str) -> object:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
    return json.loads(text)


def _segments_from_response(data: object) -> list[dict[str, Any]]:
    if isinstance(data, list):
        segments = data
    elif isinstance(data, dict) and isinstance(data.get("segments"), list):
        segments = data["segments"]
    else:
        raise RuntimeError("aos-cli music analysis output must be a segment list or {'segments': [...]}")

    normalized: list[dict[str, Any]] = []
    for item in segments:
        if not isinstance(item, dict):
            raise RuntimeError("aos-cli music analysis segments must be objects")
        normalized.append(dict(item))
    return normalized


def _add_duration_seconds(segments: list[dict[str, Any]]) -> None:
    for seg in segments:
        start_sec = parse_time(str(seg["start"]))
        end_sec = parse_time(str(seg["end"]))
        seg["duration_seconds"] = round(end_sec - start_sec, 2)


def save_timestamped_segments(segments: list[dict[str, Any]], video_stem: str, output_dir: Path = OUTPUT_DIR) -> Path:
    output_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    output_path = output_dir / f"segments-{video_stem}-{ts}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(segments, f, ensure_ascii=False, indent=2)
    return output_path


def main():
    if len(sys.argv) < 2:
        print("用法: python analyze_video.py <视频文件路径>")
        sys.exit(1)

    video_path = sys.argv[1]
    if not Path(video_path).exists():
        raise FileNotFoundError(f"找不到视频文件: {video_path}")

    video_stem = Path(video_path).stem

    segments = analyze_with_aos_cli(video_path, video_stem, output_dir=OUTPUT_DIR, cwd=Path.cwd())

    # 3. 打印分段结果
    print("\n--- 分段结果 ---")
    for seg in segments:
        needs = "🎵 需要配乐" if seg.get("needs_music") else "🔇 静音"
        dur = seg["duration_seconds"]
        print(f"  片段{seg['segment_id']} ({seg['start']}-{seg['end']}, {dur}s): {needs}")
        if seg.get("needs_music"):
            print(f"    情绪: {seg.get('情绪', '')}")

    # 4. 保存最终 JSON（包含 duration_seconds）
    output_path = save_timestamped_segments(segments, video_stem, OUTPUT_DIR)

    music_count = sum(1 for s in segments if s.get("needs_music"))
    print(f"\n✓ 已保存 {len(segments)} 个片段（{music_count} 个需要配乐）到: {output_path}")
    print(f"\n📋 下一步：将此 JSON 文件发给 MCP 音乐匹配服务进行选曲")


if __name__ == "__main__":
    main()
