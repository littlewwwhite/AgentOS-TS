"""
Phase 5：XML 字幕轨道 — 在现有 FCP XML 中追加 V2 字幕轨道
用法：python phase5_xml.py <现有XML> <ASR JSON> [--output output.xml] [--fps 24] [--style 预设名] [--video 视频路径] [--language 语言代码]
输出：带字幕轨道的 FCP XML
"""

import json
import sys
import argparse
import xml.etree.ElementTree as ET
from pathlib import Path

from styles import load_style, get_font_for_language


def parse_timestamp_to_seconds(ts: str) -> float:
    """将 MM:SS.mmm 或 HH:MM:SS.mmm 格式转为秒数"""
    # 先分离毫秒部分
    if "." in ts:
        main_part, ms_part = ts.rsplit(".", 1)
        ms = int(ms_part.ljust(3, "0")[:3]) / 1000
    else:
        main_part = ts
        ms = 0

    parts = main_part.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1]) + ms
    elif len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]) + ms
    return float(ts)


def seconds_to_frames(seconds: float, fps: int = 24) -> int:
    """秒数转帧数"""
    return int(round(seconds * fps))


def read_xml_with_doctype(xml_path: str):
    """读取可能含 DOCTYPE 或残留字符的 FCP XML"""
    content = Path(xml_path).read_text(encoding="utf-8")
    # 找到 <xmeml 开始位置，跳过 DOCTYPE 和残留字符
    idx = content.find("<xmeml")
    if idx == -1:
        raise ValueError(f"XML 中未找到 <xmeml 根元素: {xml_path}")
    clean = '<?xml version="1.0" encoding="UTF-8"?>\n' + content[idx:]
    return ET.ElementTree(ET.fromstring(clean))


def add_subtitle_track(xml_path: str, asr_data: list[dict], output_path: str, style: dict, fps: int = 24):
    """在 FCP XML 中追加 V2 字幕轨道"""
    tree = read_xml_with_doctype(xml_path)
    root = tree.getroot()

    # 找到 sequence > media > video
    seq = root.find(".//sequence")
    if seq is None:
        print("Error: XML 中未找到 sequence 元素")
        sys.exit(1)

    media = seq.find("media")
    if media is None:
        media = ET.SubElement(seq, "media")

    video = media.find("video")
    if video is None:
        video = ET.SubElement(media, "video")

    # 读取帧率（从已有 XML 中获取）
    rate_elem = seq.find(".//rate/timebase")
    if rate_elem is not None:
        fps = int(rate_elem.text)

    # 从 style dict 读取参数
    font_name = style["font_name"]
    font_size = style["font_size"]
    outline = style["outline"]
    margin_v = style["margin_v"]
    video_height = style["video_height"]
    bold = style["bold"]

    # 创建 V2 字幕轨道
    subtitle_track = ET.SubElement(video, "track")
    ET.SubElement(subtitle_track, "enabled").text = "TRUE"
    ET.SubElement(subtitle_track, "locked").text = "FALSE"

    for entry in asr_data:
        start_sec = parse_timestamp_to_seconds(entry["start"])
        end_sec = parse_timestamp_to_seconds(entry["end"])
        text = entry["text"]
        index = entry.get("index", 0)

        start_frame = seconds_to_frames(start_sec, fps)
        end_frame = seconds_to_frames(end_sec, fps)
        duration_frames = end_frame - start_frame

        if duration_frames <= 0:
            continue

        # 创建 generatoritem（Text generator）
        gen_item = ET.SubElement(subtitle_track, "generatoritem", id=f"subtitle-{index}")
        ET.SubElement(gen_item, "name").text = f"subtitle_{index}"
        ET.SubElement(gen_item, "duration").text = str(duration_frames)

        gen_rate = ET.SubElement(gen_item, "rate")
        ET.SubElement(gen_rate, "timebase").text = str(fps)
        ET.SubElement(gen_rate, "ntsc").text = "FALSE"

        ET.SubElement(gen_item, "start").text = str(start_frame)
        ET.SubElement(gen_item, "end").text = str(end_frame)
        ET.SubElement(gen_item, "in").text = "0"
        ET.SubElement(gen_item, "out").text = str(duration_frames)

        # generator effect（Text）
        effect = ET.SubElement(gen_item, "effect")
        ET.SubElement(effect, "name").text = "Text"
        ET.SubElement(effect, "effectid").text = "Text"
        ET.SubElement(effect, "effectcategory").text = "Text"
        ET.SubElement(effect, "effecttype").text = "generator"
        ET.SubElement(effect, "mediatype").text = "video"

        # 字幕文本
        param_text = ET.SubElement(effect, "parameter")
        ET.SubElement(param_text, "parameterid").text = "str"
        ET.SubElement(param_text, "name").text = "Text"
        ET.SubElement(param_text, "value").text = text

        # 字体名称
        param_font = ET.SubElement(effect, "parameter")
        ET.SubElement(param_font, "parameterid").text = "font"
        ET.SubElement(param_font, "name").text = "Font"
        ET.SubElement(param_font, "value").text = font_name

        # 字体大小
        param_size = ET.SubElement(effect, "parameter")
        ET.SubElement(param_size, "parameterid").text = "fontsize"
        ET.SubElement(param_size, "name").text = "Font Size"
        ET.SubElement(param_size, "value").text = str(font_size)

        # 字体颜色（白色 #FFFFFF）
        param_color = ET.SubElement(effect, "parameter")
        ET.SubElement(param_color, "parameterid").text = "fontcolor"
        ET.SubElement(param_color, "name").text = "Font Color"
        color_val = ET.SubElement(param_color, "value")
        ET.SubElement(color_val, "alpha").text = "255"
        ET.SubElement(color_val, "red").text = "255"
        ET.SubElement(color_val, "green").text = "255"
        ET.SubElement(color_val, "blue").text = "255"

        # 字体样式（粗体）
        param_style = ET.SubElement(effect, "parameter")
        ET.SubElement(param_style, "parameterid").text = "fontstyle"
        ET.SubElement(param_style, "name").text = "Font Style"
        ET.SubElement(param_style, "value").text = "1" if bold else "0"

        # 文字对齐（居中）
        param_align = ET.SubElement(effect, "parameter")
        ET.SubElement(param_align, "parameterid").text = "fontalign"
        ET.SubElement(param_align, "name").text = "Font Alignment"
        ET.SubElement(param_align, "value").text = "1"  # 1=Center

        # 描边/轮廓
        param_outline = ET.SubElement(effect, "parameter")
        ET.SubElement(param_outline, "parameterid").text = "outline"
        ET.SubElement(param_outline, "name").text = "Outline"
        ET.SubElement(param_outline, "value").text = str(outline)

        param_outline_color = ET.SubElement(effect, "parameter")
        ET.SubElement(param_outline_color, "parameterid").text = "outlinecolor"
        ET.SubElement(param_outline_color, "name").text = "Outline Color"
        oc_val = ET.SubElement(param_outline_color, "value")
        ET.SubElement(oc_val, "alpha").text = "255"
        ET.SubElement(oc_val, "red").text = "0"
        ET.SubElement(oc_val, "green").text = "0"
        ET.SubElement(oc_val, "blue").text = "0"

        # 阴影
        param_shadow = ET.SubElement(effect, "parameter")
        ET.SubElement(param_shadow, "parameterid").text = "shadow"
        ET.SubElement(param_shadow, "name").text = "Shadow"
        ET.SubElement(param_shadow, "value").text = str(style["shadow"])

        # 位置：底部居中
        # FCP Text generator origin 坐标系：(0,0)=左下角, (1,1)=右上角
        origin_y = margin_v / video_height if video_height > 0 else 0.042

        param_origin = ET.SubElement(effect, "parameter")
        ET.SubElement(param_origin, "parameterid").text = "origin"
        ET.SubElement(param_origin, "name").text = "Origin"
        ET.SubElement(param_origin, "value").text = f"0.5 {origin_y:.3f}"

    # 格式化并写入
    ET.indent(tree, space="    ")
    tree.write(output_path, encoding="UTF-8", xml_declaration=True)

    # 添加 DOCTYPE
    with open(output_path, "r+", encoding="utf-8") as f:
        content = f.read()
        f.seek(0)
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<!DOCTYPE xmeml>\n')
        # 去掉原来的 xml 声明
        idx = content.find("?>")
        if idx != -1:
            f.write(content[idx + 2:].lstrip("\n"))
        else:
            f.write(content)
        f.truncate()


def main():
    parser = argparse.ArgumentParser(description="Phase 5: XML 字幕轨道")
    parser.add_argument("xml_path", help="现有 FCP XML 文件路径")
    parser.add_argument("asr_json", help="ASR 转录结果 JSON 文件路径")
    parser.add_argument("--output", default=None, help="输出 XML 文件路径")
    parser.add_argument("--fps", type=int, default=24, help="帧率（默认 24，会从 XML 自动读取）")
    parser.add_argument("--style", default=None, help="样式预设名（默认自动检测视频方向）")
    parser.add_argument("--video", default=None, help="视频文件路径（用于探测尺寸自动选择样式）")
    parser.add_argument("--language", default=None, help="语言代码（zh/ja/ko/en），默认从 ASR JSON 读取")
    args = parser.parse_args()

    if not Path(args.xml_path).exists():
        print(f"Error: 找不到 XML 文件: {args.xml_path}")
        sys.exit(1)

    if not Path(args.asr_json).exists():
        print(f"Error: 找不到 ASR JSON: {args.asr_json}")
        sys.exit(1)

    # 读取 ASR JSON
    with open(args.asr_json, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    # 兼容新旧格式
    if isinstance(raw_data, dict):
        language = raw_data.get("language", "zh")
        asr_data = raw_data.get("segments", raw_data)
    else:
        language = "zh"
        asr_data = raw_data

    # 命令行语言参数优先
    if args.language:
        language = args.language

    # 确定视频路径（用于样式探测）
    video_path = args.video
    if not video_path:
        # 尝试从 XML 同目录找 _final.mp4
        xml_dir = Path(args.xml_path).parent
        xml_stem = Path(args.xml_path).stem
        if xml_stem.endswith("_final"):
            candidate = xml_dir / f"{xml_stem}.mp4"
        else:
            candidate = xml_dir / f"{xml_stem}_final.mp4"
        if candidate.exists():
            video_path = str(candidate)

    if not video_path or not Path(video_path).exists():
        print("Warning: 未找到视频文件，使用横版默认样式（如需竖版请传 --video 或 --style vertical）")
        # 提供一个 fallback：横版 720p 默认值
        style = {
            "font_name": get_font_for_language(language),
            "font_size": 20, "outline": 2,
            "margin_v": 30, "primary_colour": "&H00FFFFFF", "outline_colour": "&H00000000",
            "shadow": 0, "alignment": 2, "bold": True,
            "video_width": 1280, "video_height": 720, "orientation": "horizontal",
            "style_name": "horizontal",
            "language": language,
            "language_name": language,
        }
    else:
        style = load_style(video_path, args.style, language)

    if not asr_data:
        print("Warning: ASR JSON 为空，无字幕可添加")
        sys.exit(0)

    # 确定输出路径
    if args.output:
        output_path = args.output
    else:
        stem = Path(args.xml_path).stem
        # 去掉 _final 后缀
        if stem.endswith("_final"):
            stem = stem[:-6]
        output_path = str(Path(args.xml_path).parent / f"{stem}.xml")

    add_subtitle_track(args.xml_path, asr_data, output_path, style, fps=args.fps)

    print(f"OK XML 字幕轨道生成完成: {output_path}")
    print(f"  字幕条数: {len(asr_data)}")
    print(f"  语言: {style['language_name']} ({style['language']})")
    print(f"  样式: {style['style_name']} — {style['font_name']} {style['font_size']}px")
    print(f"  帧率: {args.fps} fps")


if __name__ == "__main__":
    main()
