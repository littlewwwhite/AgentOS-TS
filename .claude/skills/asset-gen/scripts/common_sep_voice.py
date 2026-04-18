#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common_sep_voice.py — 本地视频人声提取公共模块

流程：
  1. ffmpeg 从视频中提取全音轨 → raw WAV
  2. demucs Python API（htdemucs）分离人声 → vocals.wav
     （使用 soundfile 保存，完全绕过 torchcodec/torchaudio 兼容问题）
  3. ffmpeg 将 vocals.wav 转为 MP3

对外接口：
  sep_voice_from_video(input_video, output_mp3, *, model_name, device, work_dir) -> str

CLI 用法（独立运行）：
  python common_sep_voice.py --input video.mp4 --vocals-mp3 vocals.mp3

依赖：
  pip install demucs soundfile
  brew install ffmpeg
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")


# ── 基础工具 ──────────────────────────────────────────────────────────────────

def run_cmd(cmd: list, env: dict = None):
    """运行 shell 命令，失败时抛出 RuntimeError。"""
    print("执行命令：", " ".join(cmd))
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    print(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(f"命令执行失败，退出码: {result.returncode}")


def check_ffmpeg():
    """检查 ffmpeg 是否可用，不可用则抛出 EnvironmentError。"""
    if not shutil.which("ffmpeg"):
        raise EnvironmentError("未找到 ffmpeg，请先安装：brew install ffmpeg")


# ── Step 1：视频 → 原始 WAV ───────────────────────────────────────────────────

def extract_raw_audio(input_video: str, output_wav: str):
    """用 ffmpeg 从视频中提取全音轨为 WAV（pcm_s16le, 44100Hz, stereo）。"""
    run_cmd([
        "ffmpeg", "-y",
        "-i", input_video,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        output_wav,
    ])


# ── Step 2：WAV → vocals.wav（demucs Python API）─────────────────────────────

def separate_vocals(input_wav: str, output_dir: str,
                    model_name: str = "htdemucs",
                    device: str = "cpu") -> str:
    """
    用 demucs Python API + soundfile 分离人声。

    不调用 demucs CLI，避免 torchcodec 与 PyTorch 版本不兼容的问题。

    返回人声 WAV 的绝对路径。
    """
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    os.makedirs(output_dir, exist_ok=True)

    print(f"加载 demucs 模型: {model_name}")
    model = get_model(model_name)
    model.eval()

    # 读取 WAV（soundfile 不依赖 torchcodec）
    data, samplerate = sf.read(input_wav, dtype="float32")

    # 统一为 (channels, samples)
    if data.ndim == 1:
        data = data[None, :]          # mono → (1, samples)
    else:
        data = data.T                 # (samples, ch) → (ch, samples)

    # htdemucs 需要立体声
    if data.shape[0] == 1:
        data = np.concatenate([data, data], axis=0)

    wav = torch.from_numpy(data).unsqueeze(0)   # (1, 2, samples)

    # 必要时重采样
    if samplerate != model.samplerate:
        import torchaudio.functional as F_audio
        wav = F_audio.resample(wav, samplerate, model.samplerate)
        samplerate = model.samplerate

    print(f"分离人声（设备: {device}）...")
    model.to(device)
    with torch.no_grad():
        sources = apply_model(model, wav, device=device, progress=True)

    # sources: (1, n_sources, channels, samples)
    vocals_idx = model.sources.index("vocals")
    vocals_np = sources[0, vocals_idx].cpu().numpy().T   # (samples, channels)

    # 保存到 output_dir/<model_name>/<stem>/vocals.wav
    stem = os.path.splitext(os.path.basename(input_wav))[0]
    vocals_dir = os.path.join(output_dir, model_name, stem)
    os.makedirs(vocals_dir, exist_ok=True)
    vocals_path = os.path.join(vocals_dir, "vocals.wav")

    sf.write(vocals_path, vocals_np, model.samplerate)
    print(f"人声 WAV 已保存: {vocals_path}")
    return vocals_path


# ── Step 3：vocals.wav → MP3 ──────────────────────────────────────────────────

def convert_wav_to_mp3(input_wav: str, output_mp3: str):
    """用 ffmpeg 将 WAV 转为高质量 MP3（libmp3lame -q:a 2）。"""
    run_cmd([
        "ffmpeg", "-y",
        "-i", input_wav,
        "-vn",
        "-c:a", "libmp3lame",
        "-q:a", "2",
        output_mp3,
    ])


# ── 高层接口 ──────────────────────────────────────────────────────────────────

def sep_voice_from_video(
    input_video: str,
    output_mp3: str,
    *,
    model_name: str = "htdemucs",
    device: str = "cpu",
    work_dir: str = None,
    debug: bool = False,
) -> str:
    """
    一键从本地视频中提取人声 MP3。

    Args:
        input_video: 输入视频文件的绝对/相对路径。
        output_mp3:  输出人声 MP3 的路径（唯一保留的文件）。
        model_name:  demucs 模型名（默认 htdemucs）。
        device:      推理设备（cpu / cuda / mps）。
        work_dir:    中间文件目录；None 则自动创建临时目录，处理完后自动删除。
                     若手动指定，处理完后同样删除。

    Returns:
        output_mp3 的绝对路径（处理成功）。

    Raises:
        EnvironmentError: ffmpeg 未安装。
        FileNotFoundError: 输入视频不存在。
        RuntimeError: 任意步骤执行失败。
    """
    input_video = os.path.abspath(input_video)
    output_mp3  = os.path.abspath(output_mp3)

    if not os.path.exists(input_video):
        raise FileNotFoundError(f"输入视频不存在: {input_video}")

    check_ffmpeg()

    # work_dir：优先用传入值，否则在项目 _temp 目录下创建唯一子目录
    _BASE_TEMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "workspace", "_temp")
    os.makedirs(_BASE_TEMP, exist_ok=True)
    if work_dir is None:
        work_dir = tempfile.mkdtemp(prefix="sep_voice_", dir=_BASE_TEMP)
        os.makedirs(work_dir, exist_ok=True)
    else:
        work_dir = os.path.abspath(work_dir)
        os.makedirs(work_dir, exist_ok=True)

    try:
        stem       = os.path.splitext(os.path.basename(input_video))[0]
        raw_wav    = os.path.join(work_dir, f"{stem}_raw.wav")
        demucs_out = os.path.join(work_dir, "demucs_output")

        print(f"\n[sep_voice] 输入视频: {input_video}")

        # Step 1：视频 → 原始 WAV
        extract_raw_audio(input_video, raw_wav)

        # Step 2：WAV → vocals.wav（demucs Python API）
        vocals_wav = separate_vocals(raw_wav, demucs_out, model_name=model_name, device=device)

        # Step 3：vocals.wav → 最终 MP3
        os.makedirs(os.path.dirname(output_mp3) or ".", exist_ok=True)
        convert_wav_to_mp3(vocals_wav, output_mp3)

        print(f"\n[sep_voice] 完成 → {output_mp3}")
        return output_mp3

    finally:
        # 清理所有中间文件
        if os.path.exists(work_dir) and not debug:
            shutil.rmtree(work_dir, ignore_errors=True)
            print(f"[sep_voice] 已清理中间文件目录: {work_dir}")


# ── CLI 入口 ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="从本地视频中提取人声 MP3（demucs Python API）")
    parser.add_argument("--input",      required=True,         help="输入视频文件路径")
    parser.add_argument("--vocals-mp3", default="vocals.mp3",  help="输出人声 MP3 路径")
    parser.add_argument("--work-dir",   default=None,          help="中间文件目录（默认与 vocals-mp3 同级）")
    parser.add_argument("--model",      default="htdemucs",    help="demucs 模型名")
    parser.add_argument("--device",     default="cpu",
                        choices=["cpu", "cuda", "mps"],        help="推理设备")
    args = parser.parse_args()

    try:
        result = sep_voice_from_video(
            input_video=args.input,
            output_mp3=args.vocals_mp3,
            model_name=args.model,
            device=args.device,
            work_dir=args.work_dir,
        )
        print(f"\n人声 MP3: {result}")
    except Exception as e:
        print(f"\n处理失败: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
