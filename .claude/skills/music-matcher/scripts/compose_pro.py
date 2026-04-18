"""
Phase 3-Pro: 专业交付合成
读取上游 XML + results JSON，下载配乐，合成 mp4，生成 Premiere XML 工程文件

用法：
    python compose_pro.py <上游ep目录> <results.json> [--rank 1] [--volume -6]

输入：
    上游ep目录: 包含 ep00x.mp4 和 ep00x.xml 的目录
    results.json: MCP 匹配结果

输出（在当前目录的 output/ep00x/ 下）：
    ep00x_final.mp4    - 配好乐的视频
    ep00x_final.xml    - Premiere 工程文件（视频轨 + 独立配乐轨）
    _tmp/*.mp3         - 配乐素材（XML 相对路径引用）
"""

import os
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, unquote
from dotenv import load_dotenv

# 配置加载
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_ENV = SKILL_DIR / "assets" / "default.env"

if DEFAULT_ENV.exists():
    load_dotenv(DEFAULT_ENV, override=False)
load_dotenv(override=False)

OUTPUT_DIR = Path.cwd() / "output"

# 合成参数
COMPOSE_MUSIC_VOLUME_DB = float(os.getenv("COMPOSE_MUSIC_VOLUME_DB", "-6"))
COMPOSE_FADE_IN = float(os.getenv("COMPOSE_FADE_IN", "0.5"))
COMPOSE_FADE_OUT = float(os.getenv("COMPOSE_FADE_OUT", "1.0"))
COMPOSE_MUSIC_REF_LUFS = float(os.getenv("COMPOSE_MUSIC_REF_LUFS", "-14"))

# FCP XML 7 命名空间
FCP_NS = "http://www.apple.com/DTDs/FinalCutPro7.dtd"


def parse_time(t: str) -> float:
    """将 MM:SS 或 HH:MM:SS 格式转为秒数"""
    parts = t.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    return float(t)


def seconds_to_frames(seconds: float, fps: int = 24) -> int:
    """秒数转帧数"""
    return int(seconds * fps)


def download_audio(url: str, dest_dir: Path) -> str:
    """从 audio_url 下载音频，返回本地路径"""
    import urllib.request

    parsed = urlparse(url)
    filename = unquote(Path(parsed.path).name)
    if not filename:
        filename = f"audio_{datetime.now().strftime('%H%M%S')}.mp3"

    dest_path = dest_dir / filename
    print(f"  下载: {filename}")
    urllib.request.urlretrieve(url, str(dest_path))
    return str(dest_path)


def parse_upstream_xml(xml_path: Path) -> dict:
    """解析上游 FCP XML，提取时间线信息和原始音频轨"""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    # FCP XML 7 格式：xmeml > sequence
    seq = root.find(".//sequence")
    if seq is None:
        raise ValueError(f"无法在 {xml_path} 中找到 sequence 元素")

    info = {
        "name": seq.findtext("name", "unnamed"),
        "duration": int(seq.findtext("duration", "0")),
        "fps": 24,
        "width": 1280,
        "height": 720,
        "audio_tracks": [],  # 原始音频轨信息
        "source_video_path": None,  # 原始视频路径
    }

    # 帧率
    rate = seq.find(".//rate/timebase")
    if rate is not None:
        info["fps"] = int(rate.text)

    # 分辨率
    sc = seq.find(".//video/format/samplecharacteristics")
    if sc is not None:
        w = sc.find("width")
        h = sc.find("height")
        if w is not None:
            info["width"] = int(w.text)
        if h is not None:
            info["height"] = int(h.text)

    # 提取原始音频轨信息
    audio = seq.find(".//media/audio")
    if audio is not None:
        for track in audio.findall("track"):
            track_info = {"clipitems": []}
            for clipitem in track.findall("clipitem"):
                clip_info = {
                    "name": clipitem.findtext("name", ""),
                    "start": clipitem.findtext("start", "0"),
                    "end": clipitem.findtext("end", "0"),
                    "in": clipitem.findtext("in", "0"),
                    "out": clipitem.findtext("out", "0"),
                }
                # 提取文件引用
                file_elem = clipitem.find("file")
                if file_elem is not None:
                    clip_info["file_id"] = file_elem.get("id", "")
                    pathurl = file_elem.findtext("pathurl", "")
                    if pathurl and not info["source_video_path"]:
                        # 从第一个音频文件路径推断原视频路径
                        # file://localhost/.../ep001.mp4 -> 提取目录和文件名
                        info["source_video_path"] = pathurl
                track_info["clipitems"].append(clip_info)
            info["audio_tracks"].append(track_info)

    # 如果没有从 XML 提取到原视频路径，使用默认
    if not info["source_video_path"]:
        # 使用同目录下的 mp4
        mp4_path = xml_path.parent / (xml_path.stem + ".mp4")
        if mp4_path.exists():
            info["source_video_path"] = f"file://localhost/{mp4_path.name}"

    return info


def generate_fcp_xml(
    output_xml: Path,
    video_path: Path,
    source_video_path: Path,  # 原始视频（含原声）
    music_segments: list[dict],
    timeline_info: dict,
    audio_dir: Path,
    project_dir: Path | None = None,
):
    """
    生成 FCP XML 7 格式的 Premiere 工程文件

    包含：
    - V1: 视频轨（引用合成后的 mp4，只取视频）
    - A1-A2: 原视频音频（引用原始 mp4，可单独调整）
    - A3~An: 独立配乐轨（引用 _tmp/*.mp3）
    """
    fps = timeline_info["fps"]
    total_frames = timeline_info["duration"]
    width = timeline_info["width"]
    height = timeline_info["height"]

    # 构建 XML
    root = ET.Element("xmeml", version="5")

    # 媒体类型提示（可选，某些 NLE 需要）
    media_type = ET.Comment("Generated by music-matcher compose_pro.py")
    root.append(media_type)

    sequence = ET.SubElement(root, "sequence")
    ET.SubElement(sequence, "name").text = timeline_info["name"] + "_final"
    ET.SubElement(sequence, "duration").text = str(total_frames)

    # rate
    rate = ET.SubElement(sequence, "rate")
    ET.SubElement(rate, "timebase").text = str(fps)
    ET.SubElement(rate, "ntsc").text = "FALSE"

    # timecode
    timecode = ET.SubElement(sequence, "timecode")
    tc_rate = ET.SubElement(timecode, "rate")
    ET.SubElement(tc_rate, "timebase").text = str(fps)
    ET.SubElement(tc_rate, "ntsc").text = "FALSE"
    ET.SubElement(timecode, "string").text = "00:00:00:00"
    ET.SubElement(timecode, "frame").text = "0"
    ET.SubElement(timecode, "displayformat").text = "NDF"

    # media
    media = ET.SubElement(sequence, "media")

    # ===== VIDEO 轨 =====
    video = ET.SubElement(media, "video")
    v_format = ET.SubElement(video, "format")
    sc = ET.SubElement(v_format, "samplecharacteristics")
    ET.SubElement(sc, "width").text = str(width)
    ET.SubElement(sc, "height").text = str(height)

    v_track = ET.SubElement(video, "track")
    ET.SubElement(v_track, "enabled").text = "TRUE"
    ET.SubElement(v_track, "locked").text = "FALSE"

    # 视频片段（引用最终 mp4，但只取视频轨）
    v_clip = ET.SubElement(v_track, "clipitem", id="clipitem-v-final")
    ET.SubElement(v_clip, "name").text = video_path.stem
    ET.SubElement(v_clip, "duration").text = str(total_frames)

    v_clip_rate = ET.SubElement(v_clip, "rate")
    ET.SubElement(v_clip_rate, "timebase").text = str(fps)
    ET.SubElement(v_clip_rate, "ntsc").text = "FALSE"

    ET.SubElement(v_clip, "start").text = "0"
    ET.SubElement(v_clip, "end").text = str(total_frames)
    ET.SubElement(v_clip, "in").text = "0"
    ET.SubElement(v_clip, "out").text = str(total_frames)

    v_file = ET.SubElement(v_clip, "file", id="file-video")
    ET.SubElement(v_file, "name").text = video_path.name
    # 相对路径：视频在 XML 同级目录
    ET.SubElement(v_file, "pathurl").text = f"file://localhost/{video_path.name}"

    v_file_rate = ET.SubElement(v_file, "rate")
    ET.SubElement(v_file_rate, "timebase").text = str(fps)
    ET.SubElement(v_file_rate, "ntsc").text = "FALSE"
    ET.SubElement(v_file, "duration").text = str(total_frames)

    v_media = ET.SubElement(v_file, "media")
    v_media_video = ET.SubElement(v_media, "video")
    v_media_sc = ET.SubElement(v_media_video, "samplecharacteristics")
    ET.SubElement(v_media_sc, "width").text = str(width)
    ET.SubElement(v_media_sc, "height").text = str(height)

    # 注意：这里不包含 audio，表示只引用视频轨

    # ===== AUDIO 轨 =====
    audio = ET.SubElement(media, "audio")

    # ----- A1-A2: 原视频音频轨（引用原始视频） -----
    source_name = source_video_path.stem if source_video_path else "source"
    source_file_name = source_video_path.name if source_video_path else f"{source_name}.mp4"
    if project_dir:
        source_rel_path = str(project_dir / "output" / source_name / source_file_name)
    else:
        source_rel_path = f"output/{source_name}/{source_file_name}"

    # 原声轨 1 (左声道)
    a_track_orig1 = ET.SubElement(audio, "track")
    ET.SubElement(a_track_orig1, "enabled").text = "TRUE"
    ET.SubElement(a_track_orig1, "locked").text = "FALSE"

    a_clip_orig1 = ET.SubElement(a_track_orig1, "clipitem", id="clipitem-a-orig1")
    ET.SubElement(a_clip_orig1, "name").text = f"{source_name}_L"
    ET.SubElement(a_clip_orig1, "duration").text = str(total_frames)

    a_clip_orig1_rate = ET.SubElement(a_clip_orig1, "rate")
    ET.SubElement(a_clip_orig1_rate, "timebase").text = str(fps)
    ET.SubElement(a_clip_orig1_rate, "ntsc").text = "FALSE"

    ET.SubElement(a_clip_orig1, "start").text = "0"
    ET.SubElement(a_clip_orig1, "end").text = str(total_frames)
    ET.SubElement(a_clip_orig1, "in").text = "0"
    ET.SubElement(a_clip_orig1, "out").text = str(total_frames)

    # 源文件链接
    a_sourcetrack1 = ET.SubElement(a_clip_orig1, "sourcetrack")
    ET.SubElement(a_sourcetrack1, "mediatype").text = "audio"
    ET.SubElement(a_sourcetrack1, "trackindex").text = "1"

    a_file_orig = ET.SubElement(a_clip_orig1, "file", id="file-source-audio")
    ET.SubElement(a_file_orig, "name").text = source_file_name
    ET.SubElement(a_file_orig, "pathurl").text = f"file://localhost/{source_rel_path}"

    a_file_orig_rate = ET.SubElement(a_file_orig, "rate")
    ET.SubElement(a_file_orig_rate, "timebase").text = str(fps)
    ET.SubElement(a_file_orig_rate, "ntsc").text = "FALSE"
    ET.SubElement(a_file_orig, "duration").text = str(total_frames)

    a_file_orig_media = ET.SubElement(a_file_orig, "media")
    a_file_orig_audio = ET.SubElement(a_file_orig_media, "audio")
    a_file_orig_sc = ET.SubElement(a_file_orig_audio, "samplecharacteristics")
    ET.SubElement(a_file_orig_sc, "samplerate").text = "48000"
    ET.SubElement(a_file_orig_sc, "depth").text = "16"
    ET.SubElement(a_file_orig_audio, "channelcount").text = "2"

    # 原声轨 2 (右声道) - 复用同一个源文件
    a_track_orig2 = ET.SubElement(audio, "track")
    ET.SubElement(a_track_orig2, "enabled").text = "TRUE"
    ET.SubElement(a_track_orig2, "locked").text = "FALSE"

    a_clip_orig2 = ET.SubElement(a_track_orig2, "clipitem", id="clipitem-a-orig2")
    ET.SubElement(a_clip_orig2, "name").text = f"{source_name}_R"
    ET.SubElement(a_clip_orig2, "duration").text = str(total_frames)

    a_clip_orig2_rate = ET.SubElement(a_clip_orig2, "rate")
    ET.SubElement(a_clip_orig2_rate, "timebase").text = str(fps)
    ET.SubElement(a_clip_orig2_rate, "ntsc").text = "FALSE"

    ET.SubElement(a_clip_orig2, "start").text = "0"
    ET.SubElement(a_clip_orig2, "end").text = str(total_frames)
    ET.SubElement(a_clip_orig2, "in").text = "0"
    ET.SubElement(a_clip_orig2, "out").text = str(total_frames)

    a_sourcetrack2 = ET.SubElement(a_clip_orig2, "sourcetrack")
    ET.SubElement(a_sourcetrack2, "mediatype").text = "audio"
    ET.SubElement(a_sourcetrack2, "trackindex").text = "1"

    # 复用同一个源文件
    ET.SubElement(a_clip_orig2, "file", ref="file-source-audio")

    # ----- A3~An: 独立配乐轨 -----
    for i, seg in enumerate(music_segments, 1):
        a_track = ET.SubElement(audio, "track")
        ET.SubElement(a_track, "enabled").text = "TRUE"
        ET.SubElement(a_track, "locked").text = "FALSE"

        start_frame = seconds_to_frames(seg["start_sec"], fps)
        end_frame = seconds_to_frames(seg["start_sec"] + seg["duration"], fps)
        duration_frames = end_frame - start_frame

        # 音频片段
        music_path = seg["music_path"]  # 绝对路径
        music_name = Path(music_path).name
        # 相对路径：音频在 _tmp/ 目录
        rel_path = f"_tmp/{music_name}"

        a_clip = ET.SubElement(a_track, "clipitem", id=f"clipitem-a{i}")
        ET.SubElement(a_clip, "name").text = f"music_seg{seg['segment_id']}"
        ET.SubElement(a_clip, "duration").text = str(duration_frames)

        a_clip_rate = ET.SubElement(a_clip, "rate")
        ET.SubElement(a_clip_rate, "timebase").text = str(fps)
        ET.SubElement(a_clip_rate, "ntsc").text = "FALSE"

        ET.SubElement(a_clip, "start").text = str(start_frame)
        ET.SubElement(a_clip, "end").text = str(end_frame)
        ET.SubElement(a_clip, "in").text = "0"
        ET.SubElement(a_clip, "out").text = str(duration_frames)

        # 音频源文件引用
        a_file = ET.SubElement(a_clip, "file", id=f"file-music{i}")
        ET.SubElement(a_file, "name").text = music_name
        ET.SubElement(a_file, "pathurl").text = f"file://localhost/{rel_path}"

        a_file_rate = ET.SubElement(a_file, "rate")
        ET.SubElement(a_file_rate, "timebase").text = str(fps)
        ET.SubElement(a_file_rate, "ntsc").text = "FALSE"
        ET.SubElement(a_file, "duration").text = str(duration_frames)

        a_file_media = ET.SubElement(a_file, "media")
        a_file_audio = ET.SubElement(a_file_media, "audio")
        a_file_sc = ET.SubElement(a_file_audio, "samplecharacteristics")
        ET.SubElement(a_file_sc, "samplerate").text = "48000"
        ET.SubElement(a_file_sc, "depth").text = "16"
        ET.SubElement(a_file_audio, "channelcount").text = "2"

    # 写入文件
    tree = ET.ElementTree(root)
    ET.indent(tree, space="    ")
    tree.write(output_xml, encoding="UTF-8", xml_declaration=True)

    # 手动添加 DOCTYPE（ElementTree 不支持）
    with open(output_xml, "r+", encoding="utf-8") as f:
        content = f.read()
        f.seek(0)
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<!DOCTYPE xmeml>\n')
        f.write(content[21:])  # 去掉原来的 xml 声明


def compose_pro(
    upstream_dir: str,
    results_path: str,
    rank: int = 1,
    volume_db: float = None,
    project_dir: str = None,
):
    """
    Phase 3-Pro: 专业交付合成

    Args:
        upstream_dir: 上游 ep 目录（包含 mp4 和 xml）
        results_path: MCP 匹配结果 JSON
        rank: 使用第几名匹配
        volume_db: 配乐音量 dB
    """
    if volume_db is None:
        volume_db = COMPOSE_MUSIC_VOLUME_DB

    upstream_dir = Path(upstream_dir).resolve()
    if not upstream_dir.is_dir():
        print(f"❌ 目录不存在: {upstream_dir}")
        return

    # 找到 mp4 和 xml
    mp4_files = list(upstream_dir.glob("*.mp4"))
    xml_files = list(upstream_dir.glob("*.xml"))

    if not mp4_files:
        print(f"❌ 目录中未找到 mp4 文件: {upstream_dir}")
        return

    video_path = mp4_files[0]
    video_stem = video_path.stem

    # 解析上游 XML（如果有）
    timeline_info = {
        "name": video_stem,
        "duration": 0,
        "fps": 24,
        "width": 1280,
        "height": 720,
    }
    if xml_files:
        try:
            timeline_info = parse_upstream_xml(xml_files[0])
            print(f"✓ 读取上游 XML: {xml_files[0].name}")
        except Exception as e:
            print(f"⚠️ 解析上游 XML 失败，使用默认值: {e}")

    # 准备输出目录
    output_ep_dir = OUTPUT_DIR / video_stem
    output_ep_dir.mkdir(parents=True, exist_ok=True)

    tmp_dir = output_ep_dir / "_tmp"
    tmp_dir.mkdir(exist_ok=True)

    # 读取 results JSON
    with open(results_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "results" in data:
        results = data["results"]
    elif isinstance(data, list):
        results = data
    else:
        print("⚠️ 无法识别 results.json 格式")
        return

    if not results:
        print("⚠️ results.json 中没有匹配结果")
        return

    print(f"\n上游视频: {video_stem}")
    print(f"输出目录: {output_ep_dir}")
    print(f"配乐音量: {volume_db}dB\n")

    # 下载配乐并准备片段信息（并行下载）
    download_tasks = []
    for seg in results:
        if seg.get("skipped"):
            continue

        matches = seg.get("matches", [])
        if not matches or rank > len(matches):
            continue

        chosen = matches[rank - 1]
        audio_url = chosen.get("audio_url")
        if not audio_url:
            continue

        download_tasks.append((seg, audio_url, chosen))

    def download_task(seg, url, chosen):
        """下载单个音频文件"""
        music_path = download_audio(url, tmp_dir)
        start_sec = parse_time(seg["start"])
        end_sec = parse_time(seg["end"])
        duration = end_sec - start_sec
        return {
            "segment_id": seg["segment_id"],
            "start": seg["start"],
            "end": seg["end"],
            "start_sec": start_sec,
            "duration": duration,
            "music_path": music_path,
            "music_file": Path(music_path).name,
            "similarity": chosen.get("similarity", 0),
        }

    segments = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(download_task, seg, url, chosen): seg
            for seg, url, chosen in download_tasks
        }
        for future in as_completed(futures):
            try:
                seg_info = future.result()
                segments.append(seg_info)
                print(f"  片段{seg_info['segment_id']} ({seg_info['start']}-{seg_info['end']}): {seg_info['music_file']}")
            except Exception as e:
                seg = futures[future]
                print(f"  片段{seg['segment_id']} 下载失败: {e}")

    if not segments:
        print("⚠️ 没有可合成的片段")
        return

    # 更新 timeline_info 的 duration（如果未从 XML 获取）
    if timeline_info["duration"] == 0:
        total_duration = max(s["start_sec"] + s["duration"] for s in segments)
        timeline_info["duration"] = seconds_to_frames(total_duration, timeline_info["fps"])

    # ===== Step 1: 合成 MP4 =====
    print(f"\n正在合成 MP4...")

    inputs = ["-i", str(video_path)]
    filter_parts = []
    mix_labels = []

    for i, seg in enumerate(segments, 1):
        inputs.extend(["-i", seg["music_path"]])
        dur = seg["duration"]
        delay_ms = int(seg["start_sec"] * 1000)

        fade_in = min(COMPOSE_FADE_IN, dur * 0.15)
        fade_out = min(COMPOSE_FADE_OUT, dur * 0.25)
        fade_out_start = max(0, dur - fade_out)

        label = f"m{i}"
        filter_parts.append(
            f"[{i}:a]atrim=0:{dur:.2f},"
            f"loudnorm=I={COMPOSE_MUSIC_REF_LUFS}:TP=-1:LRA=11,"
            f"afade=t=in:d={fade_in:.2f},"
            f"afade=t=out:st={fade_out_start:.2f}:d={fade_out:.2f},"
            f"adelay={delay_ms}|{delay_ms},"
            f"apad[{label}]"
        )
        mix_labels.append(f"[{label}]")

    if len(mix_labels) == 1:
        music_out = "m1"
    else:
        filter_parts.append(
            f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=longest:normalize=0[music_mix]"
        )
        music_out = "music_mix"

    filter_parts.append(f"[{music_out}]volume={volume_db}dB[music_vol]")
    filter_parts.append(f"[0:a][music_vol]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]")

    filter_complex = ";\n".join(filter_parts)

    output_mp4 = output_ep_dir / f"{video_stem}_final.mp4"

    cmd = (
        ["ffmpeg", "-y"] + inputs +
        ["-filter_complex", filter_complex,
         "-map", "0:v", "-map", "[out]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         str(output_mp4)]
    )

    result = subprocess.run(cmd, capture_output=True, text=True, errors='ignore')
    if result.returncode != 0:
        print(f"❌ ffmpeg 报错:\n{result.stderr[-500:]}")
        return

    print(f"✓ MP4 合成完成: {output_mp4.name}")

    # ===== Step 2: 生成 XML =====
    print(f"\n正在生成 Premiere XML...")

    output_xml = output_ep_dir / f"{video_stem}_final.xml"

    resolved_project_dir = Path(project_dir) if project_dir else None
    generate_fcp_xml(
        output_xml=output_xml,
        video_path=output_mp4,
        source_video_path=video_path,
        music_segments=segments,
        timeline_info=timeline_info,
        audio_dir=tmp_dir,
        project_dir=resolved_project_dir,
    )

    print(f"✓ XML 生成完成: {output_xml.name}")

    # 汇总
    print(f"\n{'='*50}")
    print(f"交付完成: {video_stem}")
    print(f"  📹 {output_mp4.name}")
    print(f"  📄 {output_xml.name}")
    print(f"  🎵 _tmp/ ({len(segments)} 个音频文件)")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Phase 3-Pro: 专业交付合成")
    parser.add_argument("upstream_dir", help="上游 ep 目录（包含 mp4 和 xml）")
    parser.add_argument("results", help="MCP 匹配结果 results.json")
    parser.add_argument("--rank", type=int, default=1, help="使用第几名匹配（默认1）")
    parser.add_argument("--volume", type=float, default=None, help=f"配乐音量dB（默认{COMPOSE_MUSIC_VOLUME_DB}）")
    parser.add_argument("--project-dir", default=None, help="项目根目录（默认读取 PROJECT_DIR 环境变量）")
    args = parser.parse_args()

    proj_dir = args.project_dir or os.environ.get("PROJECT_DIR")
    compose_pro(args.upstream_dir, args.results, rank=args.rank, volume_db=args.volume, project_dir=proj_dir)
