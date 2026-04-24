"""
循环剪辑引擎：scn 级组装 + Gemini 质检 + 迭代替换

读取 Phase 1 analysis.json → 按 scn 组装最佳序列 → ffmpeg 拼接 →
Gemini 整体评估 → 循环替换有问题的 shot → 输出 edit_decision.json

中间产物（临时 mp4、decision）存放于 _tmp/scn{NNN}/，Phase 3 合并后可清理。

用法:
  # 处理单集（自动查找 storyboard）
  python phase2_assemble.py output/ep001 --storyboard auto

  # 指定输出目录 + 并行数
  python phase2_assemble.py output/ep001 -o results/ --concurrency 2

  # 断点续传
  python phase2_assemble.py output/ep001 --storyboard auto --skip-existing

输入:
  output/ep{NNN}/scn{NNN}/clip{NNN}/analysis.json  — Phase 1 输出

输出:
  output/ep{NNN}/_tmp/scn{NNN}/edit_decision.json  — scn 级剪辑决策（供 Phase 3 使用）
  output/ep{NNN}/_tmp/scn{NNN}/*_r{N}.mp4         — 循环评估临时视频（可清理）

依赖: pip install google-genai python-dotenv
"""

import argparse
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

# 在任何 av/scenedetect import 之前，抑制 C 层 ffmpeg/swscaler 警告
try:
    import av
    av.logging.set_level(av.logging.ERROR)
except Exception:
    os.environ.setdefault("AV_LOG_LEVEL", "error")

try:
    import cv2
    cv2.setLogLevel(0)
except Exception:
    pass

# Python 层 libav logger 也抑制（兜底）
import logging
logging.getLogger("libav").setLevel(logging.ERROR)

from dotenv import load_dotenv

# ── 配置加载（三级优先级：环境变量 > CWD/.env > skill 内置 default.env）──

SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
ASSETS_DIR = SKILL_DIR / "assets"
DEFAULT_ENV = ASSETS_DIR / "default.env"

if DEFAULT_ENV.exists():
    load_dotenv(DEFAULT_ENV, override=False)
load_dotenv(override=False)

# ── Prompt 模块 ──
sys.path.insert(0, str(ASSETS_DIR))
from phase2_loop_analysis import build as build_phase2_prompt

# ── Phase 2 参数 ──

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://api.chatfire.cn/gemini")
LOOP_GEMINI_MODEL = os.getenv("LOOP_GEMINI_MODEL", "gemini-3.1-flash-preview")
LOOP_GEMINI_TEMPERATURE = float(os.getenv("LOOP_GEMINI_TEMPERATURE", "1.0"))
LOOP_GEMINI_THINKING_LEVEL = os.getenv("LOOP_GEMINI_THINKING_LEVEL", "low")
_res = os.getenv("LOOP_GEMINI_MEDIA_RESOLUTION", "medium")
LOOP_GEMINI_MEDIA_RESOLUTION = f"MEDIA_RESOLUTION_{_res.upper()}"

LOOP_SCORE_THRESHOLD = float(os.getenv("LOOP_SCORE_THRESHOLD", "7.5"))
LOOP_MAX_ITERATIONS = int(os.getenv("LOOP_MAX_ITERATIONS", "3"))
CONCURRENCY = int(os.getenv("CONCURRENCY", "4"))

# ── 复用 Phase 1 的压缩参数 ──

COMPRESS_ENABLED = os.getenv("COMPRESS_BEFORE_UPLOAD", "true").lower() in ("true", "1", "yes")
COMPRESS_RESOLUTION = int(os.getenv("COMPRESS_RESOLUTION", "720"))
COMPRESS_FPS = int(os.getenv("COMPRESS_FPS", "12"))
COMPRESS_CRF = int(os.getenv("COMPRESS_CRF", "28"))
COMPRESS_SKIP_UNDER_MB = int(os.getenv("COMPRESS_SKIP_UNDER_MB", "100"))

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "output"))


# ═══════════════════════ 3.1 TagLibrary ═══════════════════════


class TagLibrary:
    """从 analysis.json 构建内存索引，纯代码搜索替代 shot。

    内部结构:
        {clip_id: {shots: {shot_key: {per_variant: {label: {quality_score, source_file, source_path, ...}}}}}}
    """

    def __init__(self):
        self._data = {}  # clip_id -> shots info
        self._tried = {}  # (clip_id, shot_key) -> set of tried variants

    def load_from_analysis(self, analysis_data: dict) -> None:
        """加载单 clip 的 analysis.json 数据。"""
        clip_id = analysis_data.get("clip_id", "unknown")
        clip_dir_name = analysis_data.get("clip", "unknown")
        variants_meta = {v["label"]: v for v in analysis_data.get("variants", [])}

        shots_index = {}
        for shot in analysis_data.get("shots", []):
            shot_id = shot.get("shot_id")
            shot_key = f"shot_{shot_id}"
            per_variant = {}

            for label, vdata in shot.get("per_variant", {}).items():
                vmeta = variants_meta.get(label, {})
                per_variant[label] = {
                    "quality_score": vdata.get("quality_score", 0),
                    "source_file": vmeta.get("file", ""),
                    "source_path": vmeta.get("path", ""),
                    "camera": vdata.get("camera", ""),
                    "camera_direction": vdata.get("camera_direction", ""),
                    "start": shot.get("start", 0.0),
                    "end": shot.get("end", 0.0),
                }

            shots_index[shot_key] = {"per_variant": per_variant}

        self._data[clip_id] = {
            "clip_dir": clip_dir_name,
            "shots": shots_index,
        }

    def find_replacement(
        self, clip_id: str, shot_key: str, current_variant: str
    ) -> dict | None:
        """按 quality_score 降序找替代变体，跳过已尝试过的。"""
        clip_data = self._data.get(clip_id, {})
        shot_data = clip_data.get("shots", {}).get(shot_key, {})
        per_variant = shot_data.get("per_variant", {})

        tried = self._tried.get((clip_id, shot_key), set())
        tried.add(current_variant)

        candidates = [
            (label, info)
            for label, info in per_variant.items()
            if label != current_variant and label not in tried
        ]

        if not candidates:
            return None

        candidates.sort(key=lambda x: x[1].get("quality_score", 0), reverse=True)
        best_label, best_info = candidates[0]

        # 记录为已尝试
        if (clip_id, shot_key) not in self._tried:
            self._tried[(clip_id, shot_key)] = set()
        self._tried[(clip_id, shot_key)].add(current_variant)

        return {
            "variant": best_label,
            "source_file": best_info["source_file"],
            "source_path": best_info["source_path"],
            "quality_score": best_info["quality_score"],
        }

    def has_alternatives(
        self, clip_id: str, shot_key: str, current_variant: str
    ) -> bool:
        """检查是否有未尝试的替代变体。"""
        clip_data = self._data.get(clip_id, {})
        shot_data = clip_data.get("shots", {}).get(shot_key, {})
        per_variant = shot_data.get("per_variant", {})

        tried = self._tried.get((clip_id, shot_key), set())
        tried_with_current = tried | {current_variant}

        return any(label not in tried_with_current for label in per_variant)

    @property
    def is_single_variant_only(self) -> bool:
        """检查是否所有 clip 的所有 shot 都只有 1 个变体。"""
        for clip_data in self._data.values():
            for shot_data in clip_data.get("shots", {}).values():
                if len(shot_data.get("per_variant", {})) > 1:
                    return False
        return True


# ═══════════════════════ 3.2 初始方案构建 ═══════════════════════


def build_initial_plan(
    tag_library: TagLibrary, analyses: list[dict], scn_name: str
) -> list[dict]:
    """从每个 clip 的 recommended_assembly.plan 提取初始方案。

    shot_id 加 clip 前缀：clip001_shot_1
    无 recommended_assembly 时回退到 shots 列表 + v1
    """
    plan = []

    for analysis in analyses:
        clip_id = analysis.get("clip_id", "unknown")
        clip_dir = analysis.get("clip", "unknown")
        variants_meta = {v["label"]: v for v in analysis.get("variants", [])}

        assembly = (
            analysis.get("clip_comparison", {})
            .get("recommended_assembly", {})
            .get("plan")
        )

        if assembly:
            # 使用 recommended_assembly
            for item in assembly:
                raw_shot = item.get("shot", "shot_1")
                # 标准化：确保 shot_key 格式为 shot_N
                shot_key = raw_shot if raw_shot.startswith("shot_") else f"shot_{raw_shot}"
                shot_num = re.search(r"(\d+)", shot_key)
                shot_label = f"{clip_dir}_shot_{shot_num.group(1)}" if shot_num else f"{clip_dir}_{shot_key}"

                variant = item.get("use", "v1")
                vmeta = variants_meta.get(variant, {})

                plan.append({
                    "clip_id": clip_id,
                    "clip_dir": clip_dir,
                    "shot": shot_label,
                    "shot_key": shot_key,
                    "variant": variant,
                    "source_file": item.get("source_file", vmeta.get("file", "")),
                    "source_path": vmeta.get("path", ""),
                    "in": item.get("in", 0.0),
                    "out": item.get("out", 0.0),
                    "transition": item.get("transition", "cut"),
                    "status": "ok",
                })
        else:
            # 回退：使用 shots 列表 + v1
            v1_meta = variants_meta.get("v1", {})
            for shot in analysis.get("shots", []):
                shot_id = shot.get("shot_id", 1)
                shot_key = f"shot_{shot_id}"
                shot_label = f"{clip_dir}_shot_{shot_id}"

                plan.append({
                    "clip_id": clip_id,
                    "clip_dir": clip_dir,
                    "shot": shot_label,
                    "shot_key": shot_key,
                    "variant": "v1",
                    "source_file": v1_meta.get("file", ""),
                    "source_path": v1_meta.get("path", ""),
                    "in": shot.get("start", 0.0),
                    "out": shot.get("end", 0.0),
                    "transition": "cut",
                    "status": "ok",
                })

    return plan


# ═══════════════════════ 3.3 ffmpeg 拼接 ═══════════════════════


def probe_video_dimensions(video_path: str) -> tuple[int, int]:
    """用 ffprobe 获取视频宽高，失败时返回 (1280, 720)。"""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            video_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if proc.returncode == 0:
            streams = json.loads(proc.stdout).get("streams", [])
            if streams:
                return streams[0].get("width", 1280), streams[0].get("height", 720)
    except Exception:
        pass
    return 1280, 720


def probe_video_fps(video_path: str) -> float:
    """用 ffprobe 获取视频帧率，失败时返回 24.0。"""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "json",
            video_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if proc.returncode == 0:
            streams = json.loads(proc.stdout).get("streams", [])
            if streams:
                rate_str = streams[0].get("r_frame_rate", "24/1")
                num, den = rate_str.split("/")
                return float(num) / float(den)
    except Exception:
        pass
    return 24.0


def probe_has_audio(video_path: str) -> bool:
    """用 ffprobe 检测视频是否含音频流。"""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=index",
            "-of", "json",
            video_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if proc.returncode == 0:
            streams = json.loads(proc.stdout).get("streams", [])
            return len(streams) > 0
    except Exception:
        pass
    return False


def detect_file_cuts(video_path: str) -> list[float]:
    """对单个视频文件做场景检测，返回切点秒数列表。"""
    try:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import AdaptiveDetector

        video = open_video(str(video_path), backend="pyav")
        sm = SceneManager()
        sm.add_detector(AdaptiveDetector(
            adaptive_threshold=3.0,
            min_scene_len=max(1, int(video.frame_rate * 1.0)),
            min_content_val=15.0,
            window_width=2,
        ))
        sm.detect_scenes(video, show_progress=False)
        scenes = sm.get_scene_list()
        return [round(s[0].get_seconds(), 3) for s in scenes[1:]]
    except Exception as e:
        print(f"  警告: 场景检测失败 {Path(video_path).name}: {e}")
        return []


def refine_plan_cuts(plan: list[dict], cuts_cache: dict | None = None) -> dict:
    """对跨变体切点做修正：检测新变体文件的实际切点，替换 Phase 1 基于 v1 的切点。

    Args:
        plan: 剪辑方案（会被原地修改）
        cuts_cache: {source_path: [cut_points]} 缓存，可跨调用复用

    Returns:
        更新后的 cuts_cache
    """
    if cuts_cache is None:
        cuts_cache = {}

    # 找出跨变体切点（source_path 发生变化的位置）
    for i in range(1, len(plan)):
        cur = plan[i]
        prev = plan[i - 1]

        if cur["source_path"] == prev["source_path"]:
            continue  # 同文件，切点没问题

        # 跨变体：需要修正 cur 的 in 点
        src = cur["source_path"]
        if not src:
            continue

        if src not in cuts_cache:
            print(f"  检测变体切点: {Path(src).name}")
            cuts_cache[src] = detect_file_cuts(src)

        variant_cuts = cuts_cache[src]
        if not variant_cuts:
            continue

        expected_in = cur["in"]
        nearest = min(variant_cuts, key=lambda c: abs(c - expected_in))
        delta = abs(nearest - expected_in)

        if delta > 0.01 and delta < 2.0:  # 有偏差且在合理范围内
            print(f"  切点修正 {cur['shot']}: {expected_in:.3f}s → {nearest:.3f}s "
                  f"(Δ{delta*1000:.0f}ms, {cur['variant']})")
            cur["in"] = nearest

    # 同理修正 out 点（当下一条是不同文件时）
    for i in range(len(plan) - 1):
        cur = plan[i]
        nxt = plan[i + 1]

        if cur["source_path"] == nxt["source_path"]:
            continue

        src = cur["source_path"]
        if not src or src not in cuts_cache:
            continue

        variant_cuts = cuts_cache[src]
        if not variant_cuts:
            continue

        expected_out = cur["out"]
        nearest = min(variant_cuts, key=lambda c: abs(c - expected_out))
        delta = abs(nearest - expected_out)

        if delta > 0.01 and delta < 2.0:
            print(f"  出点修正 {cur['shot']}: {expected_out:.3f}s → {nearest:.3f}s "
                  f"(Δ{delta*1000:.0f}ms, {cur['variant']})")
            cur["out"] = nearest

    return cuts_cache


def build_scn_video(plan: list[dict], output_path: str) -> tuple[bool, int, int]:
    """将 plan 中的 shots 拼接为 scn 级视频。

    filter_complex：每段 trim(帧号) + setpts + scale → concat
    分辨率从源视频自动检测，24fps, libx264
    自动检测源文件是否有音频，有则一并拼接

    Returns:
        (success, width, height)
    """
    if shutil.which("ffmpeg") is None:
        print("  错误: 未找到 ffmpeg")
        return False, 0, 0

    if not plan:
        print("  错误: plan 为空，无法拼接")
        return False, 0, 0

    # 去重输入文件（同一变体文件只输入一次）
    input_files = []
    file_index = {}  # source_path -> input index
    for item in plan:
        sp = item["source_path"]
        if sp and sp not in file_index:
            file_index[sp] = len(input_files)
            input_files.append(sp)

    if not input_files:
        print("  错误: 无有效输入文件")
        return False, 0, 0

    # 从首个源文件检测分辨率、帧率、音频
    w, h = probe_video_dimensions(input_files[0])
    fps = probe_video_fps(input_files[0])
    has_audio = probe_has_audio(input_files[0])
    print(f"  源视频: {w}x{h} @ {fps:.2f}fps, 音频: {'有' if has_audio else '无'}")

    # 构建 filter_complex（使用帧号 trim，消除浮点精度问题）
    v_filter_parts = []
    v_concat_inputs = []
    a_filter_parts = []
    a_concat_inputs = []

    for i, item in enumerate(plan):
        sp = item["source_path"]
        if not sp or sp not in file_index:
            continue

        idx = file_index[sp]
        start_frame = round(item["in"] * fps)
        end_frame = round(item["out"] * fps)
        start_sec = start_frame / fps
        end_sec = end_frame / fps

        # 视频 filter
        vs = f"vs{i}"
        v_filter_parts.append(
            f"[{idx}:v]trim=start_frame={start_frame}:end_frame={end_frame},"
            f"setpts=PTS-STARTPTS,"
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,"
            f"setsar=1[{vs}]"
        )
        v_concat_inputs.append(f"[{vs}]")

        # 音频 filter（用帧对齐后的秒数，确保音视频同步）
        if has_audio:
            _as = f"as{i}"
            a_filter_parts.append(
                f"[{idx}:a]atrim=start={start_sec}:end={end_sec},"
                f"asetpts=PTS-STARTPTS[{_as}]"
            )
            a_concat_inputs.append(f"[{_as}]")

    if not v_concat_inputs:
        print("  错误: 无有效 filter 片段")
        return False, 0, 0

    n = len(v_concat_inputs)
    all_filters = v_filter_parts + a_filter_parts
    filter_complex = ";".join(all_filters)

    if has_audio:
        filter_complex += (
            f";{''.join(v_concat_inputs)}concat=n={n}:v=1:a=0[vout]"
            f";{''.join(a_concat_inputs)}concat=n={n}:v=0:a=1[aout]"
        )
    else:
        filter_complex += f";{''.join(v_concat_inputs)}concat=n={n}:v=1:a=0[vout]"

    # 构建命令
    cmd = ["ffmpeg", "-y", "-loglevel", "warning"]
    for f in input_files:
        cmd.extend(["-i", f])

    cmd.extend(["-filter_complex", filter_complex, "-map", "[vout]"])
    if has_audio:
        cmd.extend(["-map", "[aout]", "-c:a", "aac", "-b:a", "128k"])
    else:
        cmd.append("-an")
    cmd.extend([
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-r", "24",
        "-movflags", "+faststart",
        output_path,
    ])

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    print(f"  ffmpeg 拼接 {n} 个片段...")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if proc.returncode != 0:
        print(f"  ffmpeg 拼接失败: {proc.stderr.strip()[-300:]}")
        return False, w, h

    elapsed = time.time() - t0
    size_mb = Path(output_path).stat().st_size / (1024 * 1024)
    print(f"  拼接完成: {output_path} ({size_mb:.1f} MB, {elapsed:.1f}s)")
    return True, w, h


# ═══════════════════════ 3.4 Gemini 评估 ═══════════════════════


def compress_video(video_path: str) -> str | None:
    """上传前压缩视频以节省带宽。返回压缩文件路径，跳过时返回 None。"""
    size_mb = Path(video_path).stat().st_size / (1024 * 1024)

    if not COMPRESS_ENABLED:
        return None

    if size_mb < COMPRESS_SKIP_UNDER_MB:
        return None

    if shutil.which("ffmpeg") is None:
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

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        Path(out_path).unlink(missing_ok=True)
        return None

    return out_path


def upload_video(video_path: str, client, max_retries: int = 3) -> object:
    """上传视频到 Gemini Files API，带重试。"""
    for attempt in range(1, max_retries + 1):
        try:
            tag = f" (重试 {attempt}/{max_retries})" if attempt > 1 else ""
            print(f"  正在上传视频{tag}: {Path(video_path).name}")
            video_file = client.files.upload(file=video_path)

            print(f"  等待 Gemini 处理...")
            while video_file.state.name == "PROCESSING":
                time.sleep(3)
                video_file = client.files.get(name=video_file.name)

            if video_file.state.name != "ACTIVE":
                raise RuntimeError(f"视频处理失败，状态: {video_file.state.name}")

            print(f"  上传完成: {video_file.name}")
            return video_file

        except Exception as e:
            if attempt < max_retries:
                wait = attempt * 3
                print(f"  上传失败，{wait}s 后重试: {e}")
                time.sleep(wait)
            else:
                raise


def evaluate_with_gemini(
    scn_video_path: str,
    prompt: str,
    scn_label: str,
    client,
    raw_output_dir: Path | None = None,
) -> dict:
    """上传 scn 视频并调用 Gemini 评估，返回解析后的 JSON。"""
    from google.genai import types

    # 压缩 + 上传
    compressed = compress_video(scn_video_path)
    upload_path = compressed or scn_video_path
    try:
        video_file = upload_video(upload_path, client)
    finally:
        if compressed:
            Path(compressed).unlink(missing_ok=True)

    config = types.GenerateContentConfig(
        temperature=LOOP_GEMINI_TEMPERATURE,
        thinking_config=types.ThinkingConfig(thinking_level=LOOP_GEMINI_THINKING_LEVEL),
        media_resolution=LOOP_GEMINI_MEDIA_RESOLUTION,
    )

    print(
        f"  调用 Gemini 评估 {scn_label}"
        f"（模型: {LOOP_GEMINI_MODEL}, thinking: {LOOP_GEMINI_THINKING_LEVEL}）"
    )
    t0 = time.time()

    contents = [video_file, prompt]
    response = client.models.generate_content(
        model=LOOP_GEMINI_MODEL,
        contents=contents,
        config=config,
    )
    elapsed = time.time() - t0
    print(f"  Gemini 响应完成 ({elapsed:.1f}s)")

    raw = response.text.strip()

    # 保存原始响应
    save_dir = raw_output_dir or OUTPUT_DIR
    save_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M%S")
    raw_path = save_dir / f"gemini-loop-raw-{ts}.json"
    raw_path.write_text(raw, encoding="utf-8")
    print(f"  原始输出已保存: {raw_path}")

    # 清理 markdown 代码块包裹
    cleaned = raw
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
        cleaned = cleaned.rsplit("```", 1)[0]

    return json.loads(cleaned)


# ═══════════════════════ 3.5 剪辑动作执行器 ═══════════════════════


def execute_edit_action(
    action: str,
    params: dict,
    target: dict,
    plan: list[dict],
    tag_library: "TagLibrary",
) -> tuple[bool, str]:
    """执行单个剪辑动作。

    Args:
        action: 动作类型 (trim/skip/replace_variant/add_transition/reorder)
        params: 动作参数
        target: 目标 shot 的 plan 条目
        plan: 完整的 plan 列表
        tag_library: 变体库（用于 replace_variant）

    Returns:
        (success, description): 是否成功，动作描述
    """
    shot_id = target.get("shot", "unknown")

    if action == "trim":
        # 调整切点
        trim_type = params.get("trim_type", "out")
        new_time = params.get("new_time")
        reason = params.get("reason", "")

        if new_time is None:
            return False, "trim 缺少 new_time 参数"

        old_time = target.get("out" if trim_type == "out" else "in")
        if trim_type == "out":
            target["out"] = new_time
        else:
            target["in"] = new_time

        desc = f"裁剪 {shot_id}: {trim_type} {old_time:.2f}s → {new_time:.2f}s"
        if reason:
            desc += f" ({reason})"
        return True, desc

    elif action == "skip":
        # 跳过镜头
        reason = params.get("reason", "")
        target["skip"] = True
        target["skip_reason"] = reason
        desc = f"跳过 {shot_id}"
        if reason:
            desc += f" ({reason})"
        return True, desc

    elif action == "replace_variant":
        # 替换变体
        clip_id = target.get("clip_id")
        shot_key = target.get("shot_key")
        current_variant = target.get("variant")

        if not tag_library.has_alternatives(clip_id, shot_key, current_variant):
            return False, f"无可用替代变体"

        replacement = tag_library.find_replacement(clip_id, shot_key, current_variant)
        if not replacement:
            return False, f"无可用替代变体"

        old_variant = target["variant"]
        target["variant"] = replacement["variant"]
        target["source_file"] = replacement["source_file"]
        target["source_path"] = replacement["source_path"]

        reason = params.get("reason", "")
        desc = f"替换 {shot_id}: {old_variant} → {replacement['variant']}"
        if reason:
            desc += f" ({reason})"
        return True, desc

    elif action == "add_transition":
        # 添加过渡效果
        trans_type = params.get("type", "fade")
        duration = params.get("duration", 0.3)
        reason = params.get("reason", "")

        target["transition"] = trans_type
        target["transition_duration"] = duration

        desc = f"添加过渡 {shot_id}: {trans_type} {duration}s"
        if reason:
            desc += f" ({reason})"
        return True, desc

    elif action == "reorder":
        # 调整顺序
        insert_after = params.get("insert_after")
        reason = params.get("reason", "")

        if not insert_after:
            return False, "reorder 缺少 insert_after 参数"

        # 找到目标索引
        target_idx = None
        for i, item in enumerate(plan):
            if item["shot"] == shot_id:
                target_idx = i
                break

        if target_idx is None:
            return False, f"找不到目标 shot: {shot_id}"

        # 找到插入位置
        if insert_after == "start":
            new_idx = 0
        else:
            insert_idx = None
            for i, item in enumerate(plan):
                if item["shot"] == insert_after:
                    insert_idx = i
                    break
            if insert_idx is None:
                return False, f"找不到插入位置: {insert_after}"
            new_idx = insert_idx + 1

        # 执行移动
        item = plan.pop(target_idx)
        if new_idx > target_idx:
            new_idx -= 1
        plan.insert(new_idx, item)

        desc = f"移动 {shot_id} 到 {insert_after} 之后"
        if reason:
            desc += f" ({reason})"
        return True, desc

    else:
        return False, f"未知动作类型: {action}"


def apply_edit_suggestions(
    edit_suggestions: list[dict],
    plan: list[dict],
    tag_library: "TagLibrary",
) -> tuple[list[str], list[str]]:
    """应用 Gemini 的剪辑建议。

    优先级：trim/skip/transition > reorder > replace_variant

    Returns:
        (actions_done, actions_failed): 成功和失败的动作描述列表
    """
    actions_done = []
    actions_failed = []

    # 按优先级分组
    priority_order = {
        "trim": 1,
        "skip": 1,
        "add_transition": 1,
        "reorder": 2,
        "replace_variant": 3,
    }

    sorted_suggestions = sorted(
        edit_suggestions,
        key=lambda x: priority_order.get(x.get("action", ""), 99),
    )

    # 最多执行 3 个建议
    executed = 0
    for suggestion in sorted_suggestions:
        if executed >= 3:
            break

        shot_id = suggestion.get("shot_id")
        action = suggestion.get("action")
        params = suggestion.get("params", {})

        # 找到目标
        target = None
        for item in plan:
            if item["shot"] == shot_id:
                target = item
                break

        if not target:
            actions_failed.append(f"找不到 shot: {shot_id}")
            continue

        # 跳过已标记为 skip 的
        if target.get("skip"):
            continue

        # 执行动作
        success, desc = execute_edit_action(action, params, target, plan, tag_library)

        if success:
            actions_done.append(desc)
            executed += 1
        else:
            actions_failed.append(desc)

    return actions_done, actions_failed


# ═══════════════════════ 3.6 循环引擎 ═══════════════════════


def run_loop_engine(
    plan: list[dict],
    tag_library: TagLibrary,
    scn_name: str,
    ep_name: str,
    client,
    storyboard_scn: dict | None = None,
    output_dir: Path | None = None,
    work_dir: Path | None = None,
) -> dict:
    """循环剪辑引擎：拼接 → 评估 → 执行剪辑建议 → 重复。

    核心原则：无论素材质量如何，都要输出能看的成片。

    Returns:
        {final_score, iterations, plan, iteration_log}
    """
    scn_label = f"{ep_name}_{scn_name}"
    raw_output_dir = output_dir or OUTPUT_DIR
    vid_dir = work_dir or raw_output_dir

    iteration_log = []
    best_score = 0.0
    best_plan = copy.deepcopy(plan)
    best_video_path = None
    detected_w, detected_h = 0, 0
    previous_result = None
    cuts_cache = {}
    single_variant = tag_library.is_single_variant_only
    actions_done = []  # 上一轮执行的动作

    if single_variant:
        print(f"  全部单变体，仅使用纯剪辑手段")

    max_iters = LOOP_MAX_ITERATIONS

    for iteration in range(1, max_iters + 1):
        round_label = f"第 {iteration}/{max_iters} 轮"
        print(f"\n  {'─'*30} {round_label} {'─'*30}")

        # 0. 过滤已跳过的 shot，修正切点
        active_plan = [item for item in plan if not item.get("skip")]
        if not active_plan:
            print(f"  所有 shot 都被跳过，无法继续")
            iteration_log.append({
                "round": iteration,
                "score": 0,
                "actions": ["所有 shot 被跳过，终止"],
            })
            break

        cuts_cache = refine_plan_cuts(active_plan, cuts_cache)

        # 1. ffmpeg 拼接当前方案
        video_path = str(vid_dir / f"{scn_label}_r{iteration}.mp4")
        ok, w, h = build_scn_video(active_plan, video_path)
        if w and h:
            detected_w, detected_h = w, h
        if not ok:
            print(f"  ffmpeg 拼接失败，终止循环")
            iteration_log.append({
                "round": iteration,
                "score": best_score,
                "actions": ["ffmpeg 拼接失败，终止"],
            })
            break

        # 2. 构建 prompt
        action_desc = "初始方案" if iteration == 1 else action_desc
        prompt = build_phase2_prompt(
            plan=active_plan,
            storyboard_scn=storyboard_scn,
            previous_result=previous_result,
            round_num=iteration,
            action_description=action_desc if iteration > 1 else "",
        )

        # 3. Gemini 评估
        try:
            result = evaluate_with_gemini(
                video_path, prompt, scn_label, client, raw_output_dir
            )
        except Exception as e:
            print(f"  Gemini 评估失败: {e}")
            iteration_log.append({
                "round": iteration,
                "score": best_score,
                "actions": [f"Gemini 评估失败: {e}，保留上轮最佳"],
            })
            break

        score = result.get("overall_score", 0)
        edit_suggestions = result.get("edit_suggestions", [])
        issues = result.get("issues", [])
        summary = result.get("summary", "")

        print(f"  评分: {score}/10, 建议: {len(edit_suggestions)}, 问题: {len(issues)}")
        if summary:
            print(f"  摘要: {summary[:80]}...")

        # 4. 回滚检查（非首轮）
        if iteration > 1 and score < best_score - 0.5:  # 允许 0.5 分的波动
            print(f"  分数下降 ({score} < {best_score})，回滚到上轮方案，终止循环")
            plan = copy.deepcopy(best_plan)
            iteration_log.append({
                "round": iteration,
                "score": score,
                "actions": actions_done + [f"回滚（{score} < {best_score}），终止"],
            })
            break

        # 5. 更新最佳状态
        best_score = max(best_score, score)
        best_plan = copy.deepcopy(plan)
        best_video_path = video_path
        previous_result = result

        # 更新 plan 中 shot 的 status（根据 issues）
        issue_shots = {iss.get("shot_id") for iss in issues}
        for item in plan:
            if item["shot"] in issue_shots:
                matching = [
                    iss for iss in issues if iss.get("shot_id") == item["shot"]
                ]
                if matching:
                    worst = max(matching, key=lambda x: {"high": 3, "medium": 2, "low": 1}.get(x.get("severity", "low"), 0))
                    item["status"] = "unresolved"
                    item["issue"] = worst.get("description", "")

        iteration_log.append({
            "round": iteration,
            "score": score,
            "actions": actions_done if iteration > 1 else ["初始方案"],
        })

        # 6. 终止条件
        if score >= LOOP_SCORE_THRESHOLD:
            print(f"  分数 {score} >= 阈值 {LOOP_SCORE_THRESHOLD}，终止循环")
            break

        if iteration >= max_iters:
            print(f"  达到最大轮次 {max_iters}，终止循环")
            break

        # 7. 执行剪辑建议（核心改进）
        if not edit_suggestions:
            print(f"  无剪辑建议，终止循环")
            break

        actions_done, actions_failed = apply_edit_suggestions(
            edit_suggestions, plan, tag_library
        )

        if actions_done:
            print(f"  执行: {'; '.join(actions_done)}")
        if actions_failed:
            print(f"  失败: {'; '.join(actions_failed)}")

        if not actions_done:
            print(f"  无有效剪辑动作，终止循环")
            break

        action_desc = "; ".join(actions_done)

    # 清理临时目录（仅在非 work_dir 指定时）
    if work_dir is None:
        shutil.rmtree(vid_dir, ignore_errors=True)

    # 确保返回最佳方案
    return {
        "final_score": best_score,
        "iterations": len(iteration_log),
        "plan": best_plan,
        "iteration_log": iteration_log,
        "video_dimensions": (detected_w, detected_h),
    }


# ═══════════════════════ 3.6 XML 生成 ═══════════════════════


def _tc_from_seconds(seconds: float, fps: int = 24) -> str:
    """将秒数转换为 HH:MM:SS:FF timecode。"""
    total_frames = int(round(seconds * fps))
    h = total_frames // (fps * 3600)
    remainder = total_frames % (fps * 3600)
    m = remainder // (fps * 60)
    remainder = remainder % (fps * 60)
    s = remainder // fps
    f = remainder % fps
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


def _frames_from_seconds(seconds: float, fps: int = 24) -> int:
    """将秒数转换为帧数。"""
    return int(round(seconds * fps))


def _merge_adjacent_shots(plan: list[dict], fps: int = 24) -> list[dict]:
    """合并相邻且来自同一源文件、时间连续的 shot。

    判定条件：source_path 相同 且 前 out == 后 in（帧级精度）。
    合并后 in=前.in, out=后.out, name 取第一个 shot。
    """
    if not plan:
        return plan

    merged = [copy.deepcopy(plan[0])]
    for item in plan[1:]:
        prev = merged[-1]
        same_src = prev.get("source_path") == item.get("source_path") and prev.get("source_path")
        prev_out_frame = round(prev["out"] * fps)
        cur_in_frame = round(item["in"] * fps)
        continuous = abs(prev_out_frame - cur_in_frame) <= 1

        if same_src and continuous:
            # 合并：扩展 out，保留 prev 的 name/status
            prev["out"] = item["out"]
            # 如果任一条是 unresolved，保留标记
            if item.get("status") == "unresolved":
                prev["status"] = "unresolved"
                prev["issue"] = item.get("issue", prev.get("issue", ""))
        else:
            merged.append(copy.deepcopy(item))

    return merged


def generate_xmeml(
    plan: list[dict],
    scn_label: str,
    ep_name: str,
    fps: int = 24,
    width: int = 720,
    height: int = 1280,
    audio_channels: int = 2,
    audio_sample_rate: int = 48000,
    base_dir: str | Path | None = None,
) -> str:
    """生成 xmeml version 5 的 Premiere XML。

    - 相邻同源连续 shot 自动合并为单个 clipitem
    - 同一源文件只定义一次 <file>，后续用 <file id="xxx"/> 引用
    - 单条视频轨（V1）+ 单条音频轨（A1）
    - unresolved shot 加 marker（Rose 颜色标签）
    - base_dir: 如果提供，pathurl 使用相对于此目录的相对路径
    """
    # 预处理：合并相邻同源 shot
    plan = _merge_adjacent_shots(plan, fps)

    # 计算总时长（帧）
    total_duration_sec = sum(item["out"] - item["in"] for item in plan)
    total_frames = _frames_from_seconds(total_duration_sec, fps)

    # file 去重：source_path -> file_id
    seen_files = {}  # source_path -> (file_id, source_file)
    file_counter = 0
    for item in plan:
        sp = item.get("source_path", "")
        if sp and sp not in seen_files:
            file_counter += 1
            seen_files[sp] = (f"file-{file_counter}", item.get("source_file", ""))

    # 生成 clipitem XML 片段（视频轨 + 音频轨）
    v_clipitems = []
    a_clipitems = []
    defined_files = set()  # 已输出完整定义的 file_id
    timeline_pos = 0

    for i, item in enumerate(plan):
        clip_duration_sec = item["out"] - item["in"]
        clip_frames = _frames_from_seconds(clip_duration_sec, fps)
        in_frames = _frames_from_seconds(item["in"], fps)
        out_frames = _frames_from_seconds(item["out"], fps)

        source_path = item.get("source_path", "")
        source_file = item.get("source_file", f"clip_{i+1}.mp4")
        file_id, _ = seen_files.get(source_path, (f"file-{i+1}", source_file))
        v_clip_id = f"clipitem-v{i+1}"
        a_clip_id = f"clipitem-a{i+1}"

        # 源文件总时长（用于 file 定义）
        file_duration = out_frames
        for it in plan:
            if it.get("source_path") == source_path:
                fd = _frames_from_seconds(it["out"], fps)
                if fd > file_duration:
                    file_duration = fd

        # marker
        marker_xml = ""
        if item.get("status") == "unresolved":
            issue_text = item.get("issue", "需要修复")
            marker_xml = f"""
                    <marker>
                        <comment>{issue_text}</comment>
                        <name>{item.get("shot", "")}: UNRESOLVED</name>
                        <in>-1</in>
                        <out>-1</out>
                        <color>Rose</color>
                    </marker>"""

        # file XML：首次出现完整定义，后续引用
        if file_id not in defined_files:
            defined_files.add(file_id)
            # 计算 pathurl（相对或绝对）
            if base_dir and source_path:
                try:
                    rel_path = os.path.relpath(source_path, base_dir)
                    pathurl = f"file://localhost/{rel_path}"
                except ValueError:
                    # 不同盘符（Windows），回退到绝对路径
                    pathurl = f"file://localhost{source_path}"
            else:
                pathurl = f"file://localhost{source_path}"
            file_xml = f"""\
                    <file id="{file_id}">
                        <name>{source_file}</name>
                        <pathurl>{pathurl}</pathurl>
                        <rate>
                            <timebase>{fps}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <duration>{file_duration}</duration>
                        <media>
                            <video>
                                <samplecharacteristics>
                                    <width>{width}</width>
                                    <height>{height}</height>
                                </samplecharacteristics>
                            </video>
                            <audio>
                                <samplecharacteristics>
                                    <samplerate>{audio_sample_rate}</samplerate>
                                    <depth>16</depth>
                                </samplecharacteristics>
                                <channelcount>{audio_channels}</channelcount>
                            </audio>
                        </media>
                    </file>"""
        else:
            file_xml = f'                    <file id="{file_id}"/>'

        # 视频 clipitem
        v_clipitem = f"""\
                <clipitem id="{v_clip_id}">
                    <name>{item.get("shot", source_file)}</name>
                    <duration>{file_duration}</duration>
                    <rate>
                        <timebase>{fps}</timebase>
                        <ntsc>FALSE</ntsc>
                    </rate>
                    <start>{timeline_pos}</start>
                    <end>{timeline_pos + clip_frames}</end>
                    <in>{in_frames}</in>
                    <out>{out_frames}</out>{marker_xml}
{file_xml}
                </clipitem>"""

        # 音频 clipitem
        a_clipitem = f"""\
                <clipitem id="{a_clip_id}">
                    <name>{item.get("shot", source_file)}</name>
                    <duration>{file_duration}</duration>
                    <rate>
                        <timebase>{fps}</timebase>
                        <ntsc>FALSE</ntsc>
                    </rate>
                    <start>{timeline_pos}</start>
                    <end>{timeline_pos + clip_frames}</end>
                    <in>{in_frames}</in>
                    <out>{out_frames}</out>
                    <file id="{file_id}"/>
                    <sourcetrack>
                        <mediatype>audio</mediatype>
                        <trackindex>1</trackindex>
                    </sourcetrack>
                </clipitem>"""

        v_clipitems.append(v_clipitem)
        a_clipitems.append(a_clipitem)
        timeline_pos += clip_frames

    v_clipitems_str = "\n".join(v_clipitems)
    a_clipitems_str = "\n".join(a_clipitems)

    xml = f"""\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
    <sequence>
        <name>{scn_label}</name>
        <duration>{total_frames}</duration>
        <rate>
            <timebase>{fps}</timebase>
            <ntsc>FALSE</ntsc>
        </rate>
        <timecode>
            <rate>
                <timebase>{fps}</timebase>
                <ntsc>FALSE</ntsc>
            </rate>
            <string>00:00:00:00</string>
            <frame>0</frame>
            <displayformat>NDF</displayformat>
        </timecode>
        <media>
            <video>
                <format>
                    <samplecharacteristics>
                        <width>{width}</width>
                        <height>{height}</height>
                    </samplecharacteristics>
                </format>
                <track>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
{v_clipitems_str}
                </track>
            </video>
            <audio>
                <format>
                    <samplecharacteristics>
                        <samplerate>{audio_sample_rate}</samplerate>
                        <depth>16</depth>
                    </samplecharacteristics>
                </format>
                <track>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
{a_clipitems_str}
                </track>
            </audio>
        </media>
    </sequence>
</xmeml>
"""
    return xml


# ═══════════════════════ 3.7 scn 级处理 ═══════════════════════


def extract_scn_from_storyboard(storyboard_path: str, scn_id: str) -> dict | None:
    """从 storyboard JSON 中提取指定 scn 的信息。

    scn_id 格式：scn_001（有下划线）
    """
    data = json.loads(Path(storyboard_path).read_text(encoding="utf-8"))
    scenes = data.get("scenes", [])
    for scene in scenes:
        if scene.get("scene_id") == scn_id:
            return scene
    return None


def process_single_scn(
    scn_name: str,
    ep_name: str,
    analyses: list[dict],
    client,
    storyboard_scn: dict | None = None,
    output_dir: Path | None = None,
    skip_existing: bool = False,
) -> dict | None:
    """处理单个 scn：构建 TagLibrary → 初始方案 → 循环引擎 → 输出。"""
    scn_label = f"{ep_name}_{scn_name}"
    # 中间产物存放于 _tmp/scn{NNN}/，Phase 3 合并后可清理
    out_dir = (output_dir or OUTPUT_DIR) / ep_name / "_tmp" / scn_name

    # 断点续传
    decision_path = out_dir / "edit_decision.json"
    if skip_existing and decision_path.exists():
        print(f"  跳过（已有结果）: {scn_label}")
        return {"scn": scn_name, "skipped": True}

    print(f"\n{'='*60}")
    print(f"处理 scn: {scn_label} ({len(analyses)} 个 clip)")

    # 1. 构建 TagLibrary
    tag_library = TagLibrary()
    for analysis in analyses:
        tag_library.load_from_analysis(analysis)

    # 2. 构建初始方案
    plan = build_initial_plan(tag_library, analyses, scn_name)
    if not plan:
        print(f"  错误: 无法构建初始方案（无 shot 数据）")
        return None

    print(f"  初始方案: {len(plan)} 个 shot")
    for item in plan:
        print(f"    {item['shot']}: {item['variant']} ({item['source_file']})")

    # 3. 运行循环引擎
    engine_result = run_loop_engine(
        plan=plan,
        tag_library=tag_library,
        scn_name=scn_name,
        ep_name=ep_name,
        client=client,
        storyboard_scn=storyboard_scn,
        output_dir=out_dir,
    )

    final_plan = engine_result["plan"]

    # 4. 输出 edit_decision.json
    decision = {
        "scn": scn_name,
        "ep": ep_name,
        "final_score": engine_result["final_score"],
        "iterations": engine_result["iterations"],
        "plan": final_plan,
        "iteration_log": engine_result["iteration_log"],
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    with open(decision_path, "w", encoding="utf-8") as f:
        json.dump(decision, f, ensure_ascii=False, indent=2)
    print(f"  edit_decision.json 已保存: {decision_path}")

    # 打印摘要
    print(f"\n{'─'*40}")
    print(f"scn 完成: {scn_label}")
    print(f"  最终评分: {engine_result['final_score']}/10")
    print(f"  循环轮次: {engine_result['iterations']}")
    unresolved = [item for item in final_plan if item.get("status") == "unresolved"]
    if unresolved:
        print(f"  未解决: {len(unresolved)} 个 shot")

    return {"scn": scn_name, "score": engine_result["final_score"], "skipped": False}



# ═══════════════════════ 3.8 ep 级并行调度 ═══════════════════════


def discover_scn_analyses(analysis_dir: Path) -> dict[str, list[dict]]:
    """扫描 analysis_dir 下所有 analysis.json，按 scn 分组。

    返回 {scn_name: [analysis_data, ...]}（按 clip 名排序）
    """
    scn_map = {}

    analysis_files = sorted(analysis_dir.glob("**/analysis.json"))
    for af in analysis_files:
        try:
            data = json.loads(af.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  警告: 无法读取 {af}: {e}")
            continue

        scn = data.get("scene")
        if not scn:
            # 从路径推断
            for part in af.parts:
                if re.match(r"scn\d{3}", part):
                    scn = part
                    break

        if not scn:
            print(f"  警告: 无法确定 scn: {af}")
            continue

        if scn not in scn_map:
            scn_map[scn] = []
        scn_map[scn].append(data)

    # 每个 scn 内按 clip 排序
    for scn in scn_map:
        scn_map[scn].sort(key=lambda x: x.get("clip", ""))

    return dict(sorted(scn_map.items()))


def guess_storyboard_path(analysis_dir: Path) -> str | None:
    """从 analysis 输出目录推断 storyboard 路径。

    尝试在 input 目录中查找对应的 storyboard.json。
    """
    # analysis_dir 通常是 output/ep001
    ep_name = analysis_dir.name

    # 尝试 input/ep001/ep001_storyboard.json
    input_dir = SKILL_DIR / "input" / ep_name
    sb = input_dir / f"{ep_name}_storyboard.json"
    if sb.exists():
        return str(sb)

    # Try $PROJECT_DIR/output/ep001/ep001_storyboard.json
    project_dir = os.environ.get("PROJECT_DIR")
    if project_dir:
        sb = Path(project_dir) / "output" / ep_name / f"{ep_name}_storyboard.json"
        if sb.exists():
            return str(sb)

    return None


def process_episode(
    analysis_dir: Path,
    storyboard_mode: str | None = None,
    output_dir: Path | None = None,
    concurrency: int | None = None,
    skip_existing: bool = False,
) -> None:
    """ep 级并行调度：发现所有 scn → 并行处理。"""
    analysis_dir = analysis_dir.resolve()

    # 推断 ep_name
    ep_name = analysis_dir.name
    if not re.match(r"ep\d{3}", ep_name):
        # 可能传入了更深的路径，尝试从路径中提取
        for part in analysis_dir.parts:
            if re.match(r"ep\d{3}", part):
                ep_name = part
                break

    print(f"处理 episode: {ep_name}")
    print(f"  分析目录: {analysis_dir}")

    # 发现所有 scn
    scn_map = discover_scn_analyses(analysis_dir)
    if not scn_map:
        print(f"错误: 在 {analysis_dir} 下未找到任何 analysis.json", file=sys.stderr)
        sys.exit(1)

    print(f"发现 {len(scn_map)} 个 scn:")
    for scn, analyses in scn_map.items():
        print(f"  {scn}: {len(analyses)} 个 clip")

    # API Key 检查
    if not GEMINI_API_KEY:
        print("错误: 请设置 GEMINI_API_KEY（值使用 ChatFire key，环境变量或 .env 文件）", file=sys.stderr)
        sys.exit(1)

    from google import genai as google_genai
    if GEMINI_BASE_URL:
        from google.genai import types as genai_types
        client = google_genai.Client(
            api_key=GEMINI_API_KEY,
            http_options=genai_types.HttpOptions(base_url=GEMINI_BASE_URL),
        )
    else:
        client = google_genai.Client(api_key=GEMINI_API_KEY)

    # Storyboard 处理
    storyboard_path = None
    if storyboard_mode == "auto":
        storyboard_path = guess_storyboard_path(analysis_dir)
        if storyboard_path:
            print(f"  自动定位分镜脚本: {Path(storyboard_path).name}")
        else:
            print("  未找到对应的分镜脚本")
    elif storyboard_mode:
        storyboard_path = storyboard_mode

    # 准备 scn 级 storyboard
    storyboard_scns = {}
    if storyboard_path:
        for scn_name in scn_map:
            # scn_name: scn001 → scn_id: scn_001
            scn_id = re.sub(r"(scn)(\d+)", r"\1_\2", scn_name)
            scn_data = extract_scn_from_storyboard(storyboard_path, scn_id)
            if scn_data:
                storyboard_scns[scn_name] = scn_data

    # 并行处理
    max_workers = concurrency or CONCURRENCY
    results = []

    if max_workers <= 1 or len(scn_map) <= 1:
        # 串行处理
        for scn_name, analyses in scn_map.items():
            try:
                r = process_single_scn(
                    scn_name=scn_name,
                    ep_name=ep_name,
                    analyses=analyses,
                    client=client,
                    storyboard_scn=storyboard_scns.get(scn_name),
                    output_dir=output_dir,
                    skip_existing=skip_existing,
                )
                results.append(r)
            except Exception as e:
                print(f"\n错误: 处理 {scn_name} 失败: {e}", file=sys.stderr)
                results.append(None)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {}
            for scn_name, analyses in scn_map.items():
                future = executor.submit(
                    process_single_scn,
                    scn_name=scn_name,
                    ep_name=ep_name,
                    analyses=analyses,
                    client=client,
                    storyboard_scn=storyboard_scns.get(scn_name),
                    output_dir=output_dir,
                    skip_existing=skip_existing,
                )
                futures[future] = scn_name

            for future in as_completed(futures):
                scn_name = futures[future]
                try:
                    r = future.result()
                    results.append(r)
                except Exception as e:
                    print(f"\n错误: 处理 {scn_name} 失败: {e}", file=sys.stderr)
                    results.append(None)

    # 总结
    success = sum(1 for r in results if r and not r.get("skipped"))
    skipped = sum(1 for r in results if r and r.get("skipped"))
    failed = sum(1 for r in results if r is None)

    print(f"\n{'='*60}")
    print(f"全部完成: {success} 成功, {skipped} 跳过, {failed} 失败 / 共 {len(scn_map)} 个 scn")

    if success > 0:
        scores = [r["score"] for r in results if r and not r.get("skipped") and "score" in r]
        if scores:
            avg = sum(scores) / len(scores)
            print(f"平均评分: {avg:.1f}/10")


# ═══════════════════════ 3.9 CLI ═══════════════════════


def main():
    parser = argparse.ArgumentParser(
        description="循环剪辑引擎：scn 级组装 + Gemini 质检 + 迭代替换",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 处理单集（自动查找 storyboard）
  python phase2_assemble.py output/ep001 --storyboard auto

  # 指定输出目录 + 并行数
  python phase2_assemble.py output/ep001 -o results/ --concurrency 2

  # 断点续传
  python phase2_assemble.py output/ep001 --storyboard auto --skip-existing
        """,
    )
    parser.add_argument(
        "input_analysis_dir",
        help="Phase 1 输出目录（如 output/ep001）",
    )
    parser.add_argument(
        "--storyboard",
        help='分镜脚本 JSON 路径（传 "auto" 自动查找）',
    )
    parser.add_argument(
        "-o", "--output-dir",
        help="输出目录（默认写入 input_analysis_dir 同级）",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        help=f"scn 级并行数（默认 {CONCURRENCY}）",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="跳过已有 edit_decision.json 的 scn",
    )
    parser.add_argument(
        "--project-dir",
        help="Project root directory (falls back to PROJECT_DIR env var, then CWD)",
    )
    args = parser.parse_args()

    # Set PROJECT_DIR env so guess_storyboard_for_ep can use it
    if args.project_dir:
        os.environ["PROJECT_DIR"] = args.project_dir
    elif not os.environ.get("PROJECT_DIR"):
        os.environ["PROJECT_DIR"] = os.getcwd()

    analysis_dir = Path(args.input_analysis_dir)
    if not analysis_dir.exists():
        print(f"错误: 找不到路径: {analysis_dir}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir) if args.output_dir else analysis_dir.parent
    # 如果 output_dir 就是 analysis_dir 的父级，输出到同目录
    if output_dir == analysis_dir.parent:
        output_dir = analysis_dir.parent

    process_episode(
        analysis_dir=analysis_dir,
        storyboard_mode=args.storyboard,
        output_dir=output_dir,
        concurrency=args.concurrency,
        skip_existing=args.skip_existing,
    )


if __name__ == "__main__":
    main()
