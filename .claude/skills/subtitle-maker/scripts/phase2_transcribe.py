"""
Phase 2：ASR 转录 — 通过 aos-cli model 边界对视频进行语音识别
用法：python phase2_transcribe.py <视频文件> [--glossary glossary.json] [--ep-dir output/ep001]
输出：output/ep00x/_tmp/asr.json

Model boundary note: migrated to aos-cli model audio.transcribe.
"""

import os
import sys
import json
import time
import subprocess
import shutil
import tempfile
import argparse
from pathlib import Path
from dotenv import load_dotenv

# 从 styles.py 导入统一的语言配置
from styles import get_language_config, get_asr_instruction, get_supported_languages
from common_audio_transcribe import call_audio_transcribe

# 配置加载优先级：环境变量 > CWD/.env > skill 内置 default.env
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_ENV = SKILL_DIR / "assets" / "default.env"

if DEFAULT_ENV.exists():
    load_dotenv(DEFAULT_ENV, override=False)
load_dotenv(override=False)

PROMPT_PATH = SKILL_DIR / "assets" / "asr_prompt.txt"
OUTPUT_DIR = Path.cwd() / "output"

# ASR model 参数
ASR_MODEL = os.getenv("ASR_MODEL") or os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
ASR_TEMPERATURE = float(os.getenv("ASR_TEMPERATURE", os.getenv("GEMINI_TEMPERATURE", "0.3")))
ASR_THINKING_LEVEL = os.getenv("ASR_THINKING_LEVEL", os.getenv("GEMINI_THINKING_LEVEL", "low"))
_res = os.getenv("ASR_MEDIA_RESOLUTION", os.getenv("GEMINI_MEDIA_RESOLUTION", "medium"))
ASR_MEDIA_RESOLUTION = f"MEDIA_RESOLUTION_{_res.upper()}"

# ASR 压缩参数（侧重语音质量）
COMPRESS_ENABLED = os.getenv("COMPRESS_BEFORE_UPLOAD", "true").lower() in ("true", "1", "yes")
ASR_COMPRESS_RESOLUTION = int(os.getenv("ASR_COMPRESS_RESOLUTION", "480"))
ASR_COMPRESS_FPS = int(os.getenv("ASR_COMPRESS_FPS", "6"))
ASR_COMPRESS_CRF = int(os.getenv("ASR_COMPRESS_CRF", "32"))
ASR_AUDIO_BITRATE = os.getenv("ASR_AUDIO_BITRATE", "128k")
COMPRESS_SKIP_UNDER_MB = int(os.getenv("COMPRESS_SKIP_UNDER_MB", "100"))


def compress_video(video_path: str) -> str | None:
    """ASR 专用压缩：低分辨率视频 + 高质量音频"""
    size_mb = Path(video_path).stat().st_size / (1024 * 1024)

    if not COMPRESS_ENABLED:
        print(f"视频压缩已禁用，直接上传 ({size_mb:.1f} MB)")
        return None

    if size_mb < COMPRESS_SKIP_UNDER_MB:
        print(f"文件较小 ({size_mb:.1f} MB < {COMPRESS_SKIP_UNDER_MB} MB)，跳过压缩")
        return None

    if shutil.which("ffmpeg") is None:
        print("Warning: 未找到 ffmpeg，跳过压缩")
        return None

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out_path = tmp.name
    tmp.close()

    cmd = [
        "ffmpeg", "-y", "-loglevel", "warning",
        "-i", video_path,
        "-vf", f"scale=-2:{ASR_COMPRESS_RESOLUTION}",
        "-r", str(ASR_COMPRESS_FPS),
        "-c:v", "libx264", "-crf", str(ASR_COMPRESS_CRF),
        "-c:a", "aac", "-b:a", ASR_AUDIO_BITRATE, "-ac", "1",
        "-preset", "fast", "-movflags", "+faststart",
        out_path,
    ]

    print(f"正在压缩视频 ({size_mb:.1f} MB → {ASR_COMPRESS_RESOLUTION}p/{ASR_COMPRESS_FPS}fps, 音频 {ASR_AUDIO_BITRATE})...")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode != 0:
        print(f"Warning: 压缩失败，使用原始文件\n  {proc.stderr.strip()[-200:]}")
        Path(out_path).unlink(missing_ok=True)
        return None

    out_mb = Path(out_path).stat().st_size / (1024 * 1024)
    elapsed = time.time() - t0
    print(f"OK 压缩完成: {size_mb:.1f} MB -> {out_mb:.1f} MB ({elapsed:.1f}s)")
    return out_path


def build_prompt(glossary_path: str | None, language: str = None) -> str:
    """构建 ASR 提示词，注入字幕指南和语言指令"""
    prompt_template = PROMPT_PATH.read_text(encoding="utf-8")

    # 字幕指南
    glossary_hint = "（无字幕指南）"

    if glossary_path and Path(glossary_path).exists():
        with open(glossary_path, "r", encoding="utf-8") as f:
            glossary = json.load(f)

        parts = []
        nouns = glossary.get("proper_nouns", [])
        if nouns:
            parts.append(f"专有名词：{', '.join(nouns)}")

        dialogues = glossary.get("dialogues", [])
        if dialogues:
            parts.append("对白参考：")
            for d in dialogues[:50]:  # 最多 50 条
                parts.append(f"  - {d}")

        if parts:
            glossary_hint = "\n".join(parts)

    # 语言指令（从 languages.json 读取）
    lang_instruction = get_asr_instruction(language)

    prompt = prompt_template.replace("{glossary_hint}", glossary_hint)
    prompt = prompt.replace("{language_instruction}", lang_instruction)

    return prompt


def transcribe_with_aos_cli(media_path: str, video_stem: str, prompt: str, language: str, output_dir: Path = None) -> list[dict]:
    """调用 aos-cli model 进行 ASR 转录"""
    if output_dir is None:
        output_dir = OUTPUT_DIR

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"正在调用 aos-cli ASR（capability: audio.transcribe，模型: {ASR_MODEL}，temperature: {ASR_TEMPERATURE}）...")
    segments = call_audio_transcribe(
        media_path,
        prompt,
        task=f"subtitle-maker.phase2.{video_stem}",
        model=ASR_MODEL,
        language=language,
        options={
            "temperature": ASR_TEMPERATURE,
            "thinkingLevel": ASR_THINKING_LEVEL,
            "mediaResolution": ASR_MEDIA_RESOLUTION,
        },
        cwd=Path.cwd(),
        raw_output_dir=output_dir,
    )
    print(f"OK aos-cli 识别出 {len(segments)} 条字幕")
    return segments


def main():
    parser = argparse.ArgumentParser(description="Phase 2: aos-cli audio.transcribe 转录")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("--glossary", default=None, help="字幕指南 glossary.json 路径")
    parser.add_argument("--ep-dir", default=None, help="剧集输出目录（如 output/ep001），中间产物放 _tmp/ 下")
    parser.add_argument("--language", default=None, help=f"强制指定语言，可选: {', '.join(get_supported_languages())}")
    args = parser.parse_args()

    if not Path(args.video_path).exists():
        print(f"Error: 找不到视频文件: {args.video_path}")
        sys.exit(1)

    video_stem = Path(args.video_path).stem

    # 确定输出目录
    if args.ep_dir:
        tmp_dir = Path(args.ep_dir) / "_tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        out_dir = tmp_dir
    else:
        out_dir = OUTPUT_DIR
        out_dir.mkdir(parents=True, exist_ok=True)

    # 从 glossary 读取语言
    language = args.language
    if not language and args.glossary and Path(args.glossary).exists():
        with open(args.glossary, "r", encoding="utf-8") as f:
            glossary = json.load(f)
            language = glossary.get("language", "zh")
            print(f"从 glossary 读取语言: {glossary.get('language_name', language)} ({language})")

    if not language:
        language = "zh"  # 默认中文

    # 获取语言配置
    lang_config = get_language_config(language)
    print(f"ASR 语言: {lang_config.get('name', language)} ({language})")

    # 1. 压缩视频
    compressed = compress_video(args.video_path)

    # 2. 构建提示词
    prompt = build_prompt(args.glossary, language)

    # 3. ASR 转录
    transcribe_path = compressed or args.video_path
    try:
        subtitles = transcribe_with_aos_cli(transcribe_path, video_stem, prompt, language, output_dir=out_dir)
    finally:
        if compressed:
            Path(compressed).unlink(missing_ok=True)

    # 4. 保存结果（含语言信息）
    output_path = out_dir / "asr.json"
    output_data = {
        "language": language,
        "language_name": lang_config.get("name", language),
        "segments": subtitles,
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    # 6. 打印摘要
    print(f"\n--- ASR 转录结果 ---")
    for sub in subtitles[:10]:
        speaker = sub.get("speaker", "")
        print(f"  [{sub['start']} -> {sub['end']}] {speaker}: {sub['text']}")
    if len(subtitles) > 10:
        print(f"  ... 共 {len(subtitles)} 条")

    print(f"\nOK 已保存 {len(subtitles)} 条字幕到: {output_path}")


if __name__ == "__main__":
    main()
