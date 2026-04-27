"""
Phase 4：字幕烧录 — 用 FFmpeg subtitles 滤镜将 SRT 烧录进视频
用法：python phase4_burn.py <视频文件> <SRT文件> [--output output.mp4] [--style 预设名] [--language 语言代码]
输出：带字幕的 MP4（重编码视频轨）
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from styles import load_style, get_font_for_language

# 配置加载
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_ENV = SKILL_DIR / "assets" / "default.env"

if load_dotenv is not None:
    if DEFAULT_ENV.exists():
        load_dotenv(DEFAULT_ENV, override=False)
    load_dotenv(override=False)

# 编码参数（与样式无关）
BURN_CRF = int(os.getenv("BURN_CRF", "18"))


def check_subtitles_filter():
    """检查 ffmpeg 是否支持 subtitles 滤镜（需要 libass）"""
    import shutil
    if not shutil.which("ffmpeg"):
        print("Error: 未找到 ffmpeg")
        print("  安装: brew install homebrew-ffmpeg/ffmpeg/ffmpeg")
        sys.exit(1)

    result = subprocess.run(
        ["ffmpeg", "-filters"],
        capture_output=True, text=True, errors="ignore",
    )
    if "subtitles" not in result.stdout:
        print("Error: ffmpeg 缺少 subtitles 滤镜（需要 libass 库）")
        print()
        print("  Homebrew 默认安装的 ffmpeg 是精简版，不含 libass。")
        print("  修复方法（macOS）：")
        print("    brew uninstall ffmpeg")
        print("    brew tap homebrew-ffmpeg/ffmpeg")
        print("    brew install homebrew-ffmpeg/ffmpeg/ffmpeg")
        print()
        print("  修复方法（Linux）：")
        print("    apt install ffmpeg  # 默认含 libass")
        print()
        print("  验证: ffmpeg -filters | grep subtitle")
        sys.exit(1)


def burn_subtitles(video_path: str, srt_path: str, output_path: str, style: dict):
    """用 FFmpeg subtitles 滤镜烧录字幕"""

    check_subtitles_filter()

    # 从 style dict 构建 force_style
    bold_flag = "-1" if style["bold"] else "0"
    force_style = (
        f"FontName={style['font_name']},"
        f"FontSize={style['font_size']},"
        f"PrimaryColour={style['primary_colour']},"
        f"OutlineColour={style['outline_colour']},"
        f"Outline={style['outline']},"
        f"Shadow={style['shadow']},"
        f"MarginV={style['margin_v']},"
        f"Alignment={style['alignment']},"
        f"Bold={bold_flag}"
    )

    # SRT 路径需要转义冒号和反斜杠（FFmpeg subtitles 滤镜要求）
    srt_escaped = str(Path(srt_path).resolve()).replace("\\", "/").replace(":", "\\:")

    vf = f"subtitles={srt_escaped}:force_style='{force_style}'"

    cmd = [
        "ffmpeg", "-y", "-loglevel", "warning",
        "-i", video_path,
        "-vf", vf,
        "-c:v", "libx264", "-crf", str(BURN_CRF),
        "-preset", "medium",
        "-c:a", "copy",
        "-movflags", "+faststart",
        output_path,
    ]

    print(f"正在烧录字幕...")
    print(f"  视频: {video_path} ({style['video_width']}x{style['video_height']} {style['orientation']})")
    print(f"  字幕: {srt_path}")
    print(f"  语言: {style['language_name']} ({style['language']})")
    print(f"  编码: libx264 crf={BURN_CRF}")
    print(f"  样式: {style['style_name']} — {style['font_name']} {style['font_size']}px 描边{style['outline']}px 底距{style['margin_v']}px")

    import time
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")

    if result.returncode != 0:
        print(f"Error: ffmpeg 报错:\n{result.stderr[-500:]}")
        sys.exit(1)

    elapsed = time.time() - t0
    out_mb = Path(output_path).stat().st_size / (1024 * 1024)
    print(f"OK 字幕烧录完成: {output_path} ({out_mb:.1f} MB, {elapsed:.1f}s)")


def main():
    parser = argparse.ArgumentParser(description="Phase 4: SRT 字幕烧录")
    parser.add_argument("video_path", help="输入视频文件路径")
    parser.add_argument("srt_path", help="SRT 字幕文件路径")
    parser.add_argument("--output", default=None, help="输出 MP4 文件路径")
    parser.add_argument("--style", default=None, help="样式预设名（默认自动检测视频方向）")
    parser.add_argument("--language", default=None, help="语言代码（zh/ja/ko/en），默认自动检测")
    args = parser.parse_args()

    if not Path(args.video_path).exists():
        print(f"Error: 找不到视频文件: {args.video_path}")
        sys.exit(1)

    if not Path(args.srt_path).exists():
        print(f"Error: 找不到 SRT 文件: {args.srt_path}")
        sys.exit(1)

    # 加载样式
    style = load_style(args.video_path, args.style, args.language)

    # 确定输出路径
    if args.output:
        output_path = args.output
    else:
        stem = Path(args.video_path).stem
        # 去掉 _final 后缀，加上字幕标记
        if stem.endswith("_final"):
            stem = stem[:-6]
        output_path = str(Path.cwd() / "output" / stem / f"{stem}.mp4")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    burn_subtitles(args.video_path, args.srt_path, output_path, style)


if __name__ == "__main__":
    main()
