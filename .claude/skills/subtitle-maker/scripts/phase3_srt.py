"""
Phase 3：SRT 生成 — 将 ASR JSON 转为标准 SRT 字幕文件
用法：python phase3_srt.py <asr.json> [--output ep001.srt] [--show-speaker]
输出：SRT 文件
"""

import json
import sys
import argparse
from pathlib import Path


def parse_timestamp(ts: str) -> str:
    """将 MM:SS.mmm 格式转为 SRT 格式 HH:MM:SS,mmm"""
    parts = ts.replace(".", ":").split(":")

    if len(parts) == 2:
        # MM:SS
        mm, ss = int(parts[0]), int(parts[1])
        return f"00:{mm:02d}:{ss:02d},000"
    elif len(parts) == 3:
        # MM:SS.mmm or MM:SS:mmm
        mm, ss = int(parts[0]), int(parts[1])
        ms_str = parts[2]
        # 补齐到 3 位
        ms = int(ms_str.ljust(3, "0")[:3])
        return f"00:{mm:02d}:{ss:02d},{ms:03d}"
    elif len(parts) == 4:
        # HH:MM:SS.mmm
        hh, mm, ss = int(parts[0]), int(parts[1]), int(parts[2])
        ms = int(parts[3].ljust(3, "0")[:3])
        return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"

    return ts


def asr_to_srt(asr_data: list[dict], show_speaker: bool = False) -> str:
    """将 ASR JSON 转为 SRT 格式字符串"""
    lines = []

    for i, entry in enumerate(asr_data, 1):
        start = parse_timestamp(entry["start"])
        end = parse_timestamp(entry["end"])
        text = entry["text"]

        if show_speaker and entry.get("speaker"):
            text = f"[{entry['speaker']}] {text}"

        lines.append(str(i))
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")  # 空行分隔

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Phase 3: ASR JSON -> SRT")
    parser.add_argument("asr_json", help="ASR 转录结果 JSON 文件路径")
    parser.add_argument("--output", default=None, help="输出 SRT 文件路径")
    parser.add_argument("--show-speaker", action="store_true", help="在字幕中显示角色名")
    args = parser.parse_args()

    if not Path(args.asr_json).exists():
        print(f"Error: 找不到 ASR JSON: {args.asr_json}")
        sys.exit(1)

    with open(args.asr_json, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    # 兼容新旧格式
    # 新格式: {"language": "zh", "segments": [...]}
    # 旧格式: [...]
    if isinstance(raw_data, dict):
        language = raw_data.get("language", "zh")
        asr_data = raw_data.get("segments", [])
    else:
        language = "zh"
        asr_data = raw_data

    if not asr_data:
        print("Warning: ASR JSON 为空，无字幕可生成")
        sys.exit(0)

    srt_content = asr_to_srt(asr_data, show_speaker=args.show_speaker)

    # 确定输出路径
    if args.output:
        output_path = Path(args.output)
    else:
        stem = Path(args.asr_json).stem.replace("asr-", "").replace("asr", "")
        if not stem:
            stem = "subtitle"
        output_path = Path.cwd() / "output" / f"{stem}.srt"

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(srt_content)

    print(f"OK SRT 生成完成: {output_path}")
    print(f"  语言: {language}")
    print(f"  字幕条数: {len(asr_data)}")

    # 预览前 5 条
    for entry in asr_data[:5]:
        print(f"  [{entry['start']} -> {entry['end']}] {entry['text']}")
    if len(asr_data) > 5:
        print(f"  ... 共 {len(asr_data)} 条")


if __name__ == "__main__":
    main()
