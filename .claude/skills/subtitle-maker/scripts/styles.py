"""
字幕样式加载模块 — 读取 styles.json 预设和 languages.json 语言配置
用法：python styles.py <视频文件> [--style 预设名] [--language 语言代码]
"""

import json
import subprocess
import sys
import argparse
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
STYLES_JSON = SKILL_DIR / "assets" / "styles.json"
LANGUAGES_JSON = SKILL_DIR / "assets" / "languages.json"

# 缓存
_languages_cache = None


def _load_languages() -> dict:
    """加载语言配置（带缓存）"""
    global _languages_cache
    if _languages_cache is not None:
        return _languages_cache

    if not LANGUAGES_JSON.exists():
        print(f"Error: 找不到语言配置文件: {LANGUAGES_JSON}")
        sys.exit(1)

    with open(LANGUAGES_JSON, "r", encoding="utf-8") as f:
        _languages_cache = json.load(f)

    return _languages_cache


def get_supported_languages() -> list[str]:
    """获取支持的语言代码列表"""
    config = _load_languages()
    return list(config.get("languages", {}).keys())


def get_language_config(language_code: str) -> dict:
    """
    获取语言配置。

    返回:
    {
        "name": "简体中文",
        "name_en": "Simplified Chinese",
        "font": "Noto Sans CJK SC",
        "asr_instruction": "请使用简体中文转录...",
        "detect": {...}
    }
    """
    config = _load_languages()
    languages = config.get("languages", {})

    if language_code in languages:
        return languages[language_code]

    # 回退到默认语言
    default = config.get("default_language", "zh")
    if default in languages:
        print(f"Warning: 未知语言 '{language_code}'，使用默认 '{default}'")
        return languages[default]

    # 兜底
    return {
        "name": language_code,
        "name_en": language_code,
        "font": config.get("default_font", "Noto Sans"),
        "asr_instruction": f"Transcribe in {language_code}.",
        "detect": {}
    }


def get_font_for_language(language_code: str) -> str:
    """根据语言代码获取对应字体"""
    lang_config = get_language_config(language_code)
    return lang_config.get("font", "Noto Sans")


def get_asr_instruction(language_code: str) -> str:
    """获取 ASR 转录指令"""
    lang_config = get_language_config(language_code)
    return lang_config.get("asr_instruction", "Transcribe in the spoken language.")


def detect_language(texts: list[str]) -> str:
    """根据文本内容检测语言"""
    config = _load_languages()
    languages = config.get("languages", {})

    if not texts:
        return config.get("default_language", "zh")

    combined = " ".join(texts)

    # 统计各类字符
    cjk_count = 0
    hiragana_count = 0
    katakana_count = 0
    hangul_count = 0
    latin_count = 0

    for char in combined:
        code = ord(char)
        # CJK 统一汉字
        if 0x4E00 <= code <= 0x9FFF:
            cjk_count += 1
        # 日文平假名
        elif 0x3040 <= code <= 0x309F:
            hiragana_count += 1
        # 日文片假名
        elif 0x30A0 <= code <= 0x30FF:
            katakana_count += 1
        # 韩文
        elif 0xAC00 <= code <= 0xD7AF:
            hangul_count += 1
        # 拉丁字母
        elif (0x0041 <= code <= 0x005A) or (0x0061 <= code <= 0x007A):
            latin_count += 1

    total_chars = cjk_count + hiragana_count + katakana_count + hangul_count + latin_count
    if total_chars == 0:
        return config.get("default_language", "zh")

    # 判断逻辑
    kana_count = hiragana_count + katakana_count

    # 有假名 + 汉字 = 日语
    if kana_count > 0 and cjk_count > 0:
        return "ja"

    # 韩文字符占主导
    if hangul_count > cjk_count:
        return "ko"

    # 主要是汉字
    if cjk_count > latin_count * 0.3:
        return "zh"

    # 主要是拉丁字母
    if latin_count > 0:
        return "en"

    return config.get("default_language", "zh")


def _probe_video_dimensions(video_path: str) -> tuple[int, int]:
    """用 ffprobe 获取视频宽高"""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")
    if result.returncode != 0:
        print(f"Error: ffprobe 失败: {result.stderr.strip()}")
        sys.exit(1)

    parts = result.stdout.strip().split(",")
    if len(parts) < 2:
        print(f"Error: ffprobe 输出格式异常: {result.stdout.strip()}")
        sys.exit(1)

    return int(parts[0]), int(parts[1])


def _detect_orientation(width: int, height: int) -> str:
    """判断视频方向：宽 >= 高 为 horizontal，否则 vertical"""
    return "horizontal" if width >= height else "vertical"


def load_style(video_path: str, style_name: str = None, language: str = None) -> dict:
    """
    加载字幕样式预设，根据视频方向和语言自动选择。

    返回:
    {
        "font_name": "Noto Sans CJK SC",
        "font_size": 20,        # 实际像素
        "outline": 2,           # 实际像素
        "margin_v": 30,         # 实际像素
        "primary_colour": "&H00FFFFFF",
        "outline_colour": "&H00000000",
        "shadow": 0,
        "alignment": 2,
        "bold": True,
        "video_width": 1280,
        "video_height": 720,
        "orientation": "horizontal",
        "language": "zh",
        "language_name": "简体中文",
        "style_name": "horizontal"
    }
    """
    # 读取样式预设
    if not STYLES_JSON.exists():
        print(f"Error: 找不到样式预设文件: {STYLES_JSON}")
        sys.exit(1)

    with open(STYLES_JSON, "r", encoding="utf-8") as f:
        styles_data = json.load(f)

    # 获取语言配置
    lang_config = get_language_config(language) if language else get_language_config("zh")
    font_name = lang_config.get("font", "Noto Sans")

    # 探测视频尺寸
    width, height = _probe_video_dimensions(video_path)
    orientation = _detect_orientation(width, height)

    # 确定预设名
    if style_name and style_name != "auto":
        preset_key = style_name
    else:
        preset_key = orientation

    if preset_key not in styles_data:
        available = [k for k in styles_data if not k.startswith("_")]
        print(f"Error: 未知样式预设 '{preset_key}'，可用: {', '.join(available)}")
        sys.exit(1)

    preset = styles_data[preset_key]

    # 比例系数 × 视频高度 → 实际像素
    font_size_ratio = preset.get("font_size_ratio", 0.028)
    outline_ratio = preset.get("outline_ratio", 0.003)
    margin_v_ratio = preset.get("margin_v_ratio", 0.042)

    font_size = max(1, round(font_size_ratio * height))
    outline = max(0, round(outline_ratio * height))
    margin_v = max(0, round(margin_v_ratio * height))

    return {
        "font_name": font_name,
        "font_size": font_size,
        "outline": outline,
        "margin_v": margin_v,
        "primary_colour": preset.get("primary_colour", "&H00FFFFFF"),
        "outline_colour": preset.get("outline_colour", "&H00000000"),
        "shadow": preset.get("shadow", 0),
        "alignment": preset.get("alignment", 2),
        "bold": preset.get("bold", True),
        "video_width": width,
        "video_height": height,
        "orientation": orientation,
        "language": language or "zh",
        "language_name": lang_config.get("name", language or "zh"),
        "style_name": preset_key,
    }


def main():
    parser = argparse.ArgumentParser(description="字幕样式预设查看/测试")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("--style", default=None, help="样式预设名（默认自动检测方向）")
    parser.add_argument("--language", default=None, help="语言代码，默认中文")
    args = parser.parse_args()

    if not Path(args.video_path).exists():
        print(f"Error: 找不到视频文件: {args.video_path}")
        sys.exit(1)

    style = load_style(args.video_path, args.style, args.language)

    print(f"视频: {args.video_path}")
    print(f"  尺寸: {style['video_width']}x{style['video_height']}")
    print(f"  方向: {style['orientation']}")
    print(f"  样式: {style['style_name']}")
    print(f"  语言: {style['language_name']} ({style['language']})")
    print(f"  字体: {style['font_name']}")
    print(f"  字号: {style['font_size']}px (ratio={style['font_size']/style['video_height']:.4f})")
    print(f"  描边: {style['outline']}px")
    print(f"  底距: {style['margin_v']}px")
    print(f"  粗体: {style['bold']}")

    print(f"\n支持的语言: {', '.join(get_supported_languages())}")


if __name__ == "__main__":
    main()
