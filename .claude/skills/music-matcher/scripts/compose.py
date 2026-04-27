"""
合成配乐视频
读取 MCP 匹配服务返回的 results.json，从 audio_url 下载音频并混入原视频
用法：python compose.py <原视频路径> <results.json> [--rank 1] [--volume -10]
输出：output/compose-<视频名>-<时间戳>.mp4
"""

import os
import json
import subprocess
import sys
import tempfile
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, unquote

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# 配置加载优先级：环境变量 > CWD/.env > skill 内置 default.env
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_ENV = SKILL_DIR / "assets" / "default.env"

if load_dotenv is not None:
    if DEFAULT_ENV.exists():
        load_dotenv(DEFAULT_ENV, override=False)
    load_dotenv(override=False)

OUTPUT_DIR = Path.cwd() / "output"

# 合成参数
COMPOSE_MUSIC_VOLUME_DB = float(os.getenv("COMPOSE_MUSIC_VOLUME_DB", "-6"))
COMPOSE_FADE_IN = float(os.getenv("COMPOSE_FADE_IN", "0.5"))
COMPOSE_FADE_OUT = float(os.getenv("COMPOSE_FADE_OUT", "1.0"))
COMPOSE_MUSIC_REF_LUFS = float(os.getenv("COMPOSE_MUSIC_REF_LUFS", "-14"))
COMPOSE_DUCKING = os.getenv("COMPOSE_DUCKING", "false").lower() in ("true", "1", "yes")


def parse_time(t: str) -> float:
    """将 MM:SS 格式转为秒数"""
    parts = t.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    return float(t)


def download_audio(url: str, dest_dir: str) -> str:
    """从 audio_url 下载音频到临时目录，返回本地路径"""
    import urllib.request

    # 从 URL 提取文件名
    parsed = urlparse(url)
    filename = unquote(Path(parsed.path).name)
    if not filename:
        filename = "audio.mp3"

    dest_path = os.path.join(dest_dir, filename)
    print(f"  下载音频: {filename}")
    urllib.request.urlretrieve(url, dest_path)
    return dest_path


def get_video_duration(video_path: str) -> float:
    """获取视频时长（秒）"""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video_path],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def compose(video_path: str, results_path: str, rank: int = 1,
            volume_db: float = None, output_path: str = None):
    """
    合成配乐视频

    Args:
        video_path: 原视频路径
        results_path: MCP 匹配服务输出的 results.json
        rank: 使用第几名的匹配结果（默认 1 = Top1）
        volume_db: 配乐音量（dB），负值表示降低
        output_path: 自定义输出路径（批量模式用，不带时间戳）
    """
    if volume_db is None:
        volume_db = COMPOSE_MUSIC_VOLUME_DB

    video_path = str(Path(video_path).resolve())
    video_stem = Path(video_path).stem

    with open(results_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 适配 MCP 返回格式：外层可能有 results key
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

    # 创建临时目录用于下载音频
    tmp_dir = tempfile.mkdtemp(prefix="music-matcher-")

    try:
        # 准备每个片段的配乐信息
        segments = []
        for seg in results:
            if seg.get("skipped"):
                print(f"  ⏭️  片段{seg['segment_id']}: {seg.get('skip_reason', '已跳过')}")
                continue

            matches = seg.get("matches", [])
            if not matches:
                print(f"  ⚠️ 片段{seg['segment_id']}: 无匹配结果，跳过")
                continue

            # 直接按 rank 选取
            if rank > len(matches):
                print(f"  ⚠️ 片段{seg['segment_id']}: 没有第{rank}名匹配，跳过")
                continue
            chosen = matches[rank - 1]

            # 从 audio_url 下载音频
            audio_url = chosen.get("audio_url")
            if not audio_url:
                print(f"  ⚠️ 片段{seg['segment_id']}: 匹配结果无 audio_url，跳过")
                continue

            music_path = download_audio(audio_url, tmp_dir)
            start_sec = parse_time(seg["start"])
            end_sec = parse_time(seg["end"])
            duration = end_sec - start_sec

            segments.append({
                "segment_id": seg["segment_id"],
                "start": seg["start"],
                "end": seg["end"],
                "start_sec": start_sec,
                "duration": duration,
                "music_path": music_path,
                "music_file": chosen.get("filename", Path(music_path).name),
                "similarity": chosen.get("similarity", 0),
                "情绪_target": seg.get("情绪", ""),
                "情绪_music": chosen.get("情绪", ""),
            })

        if not segments:
            print("⚠️ 没有可合成的片段")
            return

        print(f"\n原视频: {video_stem}")
        print(f"配乐音量: {volume_db}dB | 淡入: {COMPOSE_FADE_IN}s | 淡出: {COMPOSE_FADE_OUT}s")
        print(f"响度归一: {COMPOSE_MUSIC_REF_LUFS} LUFS | 人声闪避: {'开启' if COMPOSE_DUCKING else '关闭'}")
        print(f"共 {len(segments)} 个片段需要合成:\n")

        for s in segments:
            print(f"  片段{s['segment_id']} ({s['start']}-{s['end']}): "
                  f"{s['music_file']} [相似度: {s['similarity']}]")

        # 构建 ffmpeg 命令
        inputs = ["-i", video_path]
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
            # 裁剪 → 响度归一化 → 淡入 → 淡出 → 延迟定位 → 补静音
            filter_parts.append(
                f"[{i}:a]atrim=0:{dur:.2f},"
                f"loudnorm=I={COMPOSE_MUSIC_REF_LUFS}:TP=-1:LRA=11,"
                f"afade=t=in:d={fade_in:.2f},"
                f"afade=t=out:st={fade_out_start:.2f}:d={fade_out:.2f},"
                f"adelay={delay_ms}|{delay_ms},"
                f"apad[{label}]"
            )
            mix_labels.append(f"[{label}]")

        # 混合所有配乐轨
        if len(mix_labels) == 1:
            music_out = "m1"
        else:
            filter_parts.append(
                f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=longest:normalize=0[music_mix]"
            )
            music_out = "music_mix"

        # 配乐降音量
        filter_parts.append(f"[{music_out}]volume={volume_db}dB[music_vol]")

        if COMPOSE_DUCKING:
            filter_parts.append(f"[0:a]asplit=2[dialog][sc]")
            filter_parts.append(
                f"[music_vol][sc]sidechaincompress="
                f"threshold=0.02:ratio=6:attack=200:release=1000[ducked]"
            )
            filter_parts.append(
                f"[dialog][ducked]amix=inputs=2:duration=first:normalize=0[out]"
            )
        else:
            filter_parts.append(
                f"[0:a][music_vol]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]"
            )

        filter_complex = ";\n".join(filter_parts)

        # 输出路径
        OUTPUT_DIR.mkdir(exist_ok=True)
        if output_path:
            output_video = Path(output_path)
            output_video.parent.mkdir(exist_ok=True)
        else:
            ts = datetime.now().strftime("%m%d%H%M")
            output_video = OUTPUT_DIR / f"compose-{video_stem}-{ts}.mp4"

        cmd = (
            ["ffmpeg", "-y"] + inputs +
            ["-filter_complex", filter_complex,
             "-map", "0:v", "-map", "[out]",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             str(output_video)]
        )

        print(f"\n正在合成...")
        result = subprocess.run(cmd, capture_output=True, text=True, errors='ignore')
        if result.returncode != 0:
            print(f"❌ ffmpeg 报错:\n{result.stderr[-500:]}")
            return

        print(f"✓ 合成完成: {output_video.name}")

        # 保存配乐清单
        sheet_path = output_video.with_suffix(".txt")
        with open(sheet_path, "w", encoding="utf-8") as f:
            f.write(f"配乐清单 - {video_stem}\n")
            f.write(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
            f.write(f"配乐音量: {volume_db}dB\n")
            f.write(f"{'='*60}\n\n")
            for s in segments:
                f.write(f"片段{s['segment_id']} ({s['start']} - {s['end']})\n")
                f.write(f"  配乐: {s['music_file']}\n")
                f.write(f"  相似度: {s['similarity']}\n")
                f.write(f"  目标情绪: {s['情绪_target']}\n")
                f.write(f"  音乐情绪: {s['情绪_music']}\n\n")
        print(f"✓ 配乐清单: {sheet_path.name}")

    finally:
        # 清理临时下载目录
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="合成配乐视频")
    parser.add_argument("video", help="原视频文件路径")
    parser.add_argument("results", help="MCP 匹配服务输出的 results.json")
    parser.add_argument("--rank", type=int, default=1,
                        help="使用第几名匹配（默认1=Top1）")
    parser.add_argument("--volume", type=float, default=None,
                        help=f"配乐音量dB（默认{COMPOSE_MUSIC_VOLUME_DB}）")
    args = parser.parse_args()
    compose(args.video, args.results, rank=args.rank, volume_db=args.volume)
