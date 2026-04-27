"""
视频分镜分析：clip 组对比分析

Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
This phase uploads video bytes to Gemini Files API for multi-variant comparison
analysis. aos-cli model v1 has no contract for video file upload + multi-clip
comparison, so this path stays on the direct SDK pending protocol expansion.

以 clip 目录为最小单位，一次发送同 clip 的所有变体（1-6个）给 Gemini，
实现逐 shot 对比分析，输出供下游剪辑 AI 直接消费的结构化数据。

两步流水线:
  Step 1: PySceneDetect 检测 shot 切点（每个变体独立检测）
  Step 2: Gemini 多模态分析所有变体 → 逐 shot 对比 JSON

用法:
  # 单 clip 目录（自动发现内部所有 .mp4 变体）
  python phase1_analyze.py $PROJECT_DIR/output/ep001/scn001/clip001

  # scn 目录（处理下属所有 clip）
  python phase1_analyze.py $PROJECT_DIR/output/ep001/scn001

  # ep 目录（处理下属所有 scn/clip）
  python phase1_analyze.py $PROJECT_DIR/output/ep001

  # 指定输出目录 + 断点续传
  python phase1_analyze.py $PROJECT_DIR/output/ep001 -o output/ --skip-existing

输出:
  {OUTPUT_DIR}/ep{NNN}/_tmp/scn{NNN}/clip{NNN}/analysis.json  — 单 clip 分析
  {OUTPUT_DIR}/ep{NNN}/ep{NNN}_analysis_index.json            — ep 级汇总索引

依赖: pip install google-genai python-dotenv scenedetect av
"""

import argparse
import json
import logging
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
# 将 assets/ 加入 sys.path，按阶段 import prompt 模块
sys.path.insert(0, str(ASSETS_DIR))
from phase1_clip_scoring import build as build_phase1_prompt

# ── Gemini 参数 ──

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://api.chatfire.cn/gemini")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
GEMINI_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "1.0"))
GEMINI_THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "low")
_res = os.getenv("GEMINI_MEDIA_RESOLUTION", "medium")
GEMINI_MEDIA_RESOLUTION = f"MEDIA_RESOLUTION_{_res.upper()}"

# ── 视频压缩参数 ──

COMPRESS_ENABLED = os.getenv("COMPRESS_BEFORE_UPLOAD", "true").lower() in ("true", "1", "yes")
COMPRESS_RESOLUTION = int(os.getenv("COMPRESS_RESOLUTION", "720"))
COMPRESS_FPS = int(os.getenv("COMPRESS_FPS", "12"))
COMPRESS_CRF = int(os.getenv("COMPRESS_CRF", "28"))
COMPRESS_SKIP_UNDER_MB = int(os.getenv("COMPRESS_SKIP_UNDER_MB", "100"))

# ── PySceneDetect 参数 ──

SCENE_DETECT_MODE = os.getenv("SCENE_DETECT_MODE", "adaptive")
SCENE_DETECT_THRESHOLD = float(os.getenv("SCENE_DETECT_THRESHOLD", "37.0"))
SCENE_DETECT_ADAPTIVE_THRESHOLD = float(os.getenv("SCENE_DETECT_ADAPTIVE_THRESHOLD", "3.0"))
SCENE_DETECT_MIN_CONTENT_VAL = float(os.getenv("SCENE_DETECT_MIN_CONTENT_VAL", "15.0"))
SCENE_DETECT_WINDOW_WIDTH = int(os.getenv("SCENE_DETECT_WINDOW_WIDTH", "2"))
SCENE_DETECT_MIN_SCENE_SEC = float(os.getenv("SCENE_DETECT_MIN_SCENE_SEC", "1.0"))

# ── 变体 & 输出 ──

MAX_VARIANTS = int(os.getenv("MAX_VARIANTS", "6"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "output"))

# ── 并行参数 ──

PHASE1_CLIP_CONCURRENCY = int(os.getenv("PHASE1_CLIP_CONCURRENCY", "3"))
PHASE1_VARIANT_CONCURRENCY = int(os.getenv("PHASE1_VARIANT_CONCURRENCY", "3"))


# ═══════════════════════ 工具函数 ═══════════════════════

# Python 层 libav logger 也抑制（兜底）
logging.getLogger("libav").setLevel(logging.ERROR)


def get_video_meta(video_path: Path) -> dict:
    """获取视频元信息（duration, fps），不依赖 Gemini。"""
    from scenedetect import open_video
    try:
        v = open_video(str(video_path), backend="pyav")
        return {
            "duration": round(v.duration.get_seconds(), 3),
            "fps": round(v.frame_rate, 2),
        }
    except Exception:
        return {"duration": None, "fps": None}


def discover_variants(clip_dir: Path) -> list[dict]:
    """扫描 clip 目录下的 .mp4，按命名排序返回变体列表。

    命名规则：无后缀=v1, _002=v2, _003=v3...
    返回 [{path, label, stem}]
    """
    mp4s = sorted(clip_dir.glob("*.mp4"))
    if not mp4s:
        return []

    variants = []
    for mp4 in mp4s:
        stem = mp4.stem
        match = re.search(r"_(\d{3})$", stem)
        if match:
            num = int(match.group(1))
            label = f"v{num}"
        else:
            label = "v1"
        variants.append({"path": mp4, "label": label, "stem": stem})

    variants.sort(key=lambda v: v["label"])

    if len(variants) > MAX_VARIANTS:
        print(f"  变体数 {len(variants)} 超过上限 {MAX_VARIANTS}，取前 {MAX_VARIANTS} 个")
        variants = variants[:MAX_VARIANTS]

    return variants


def discover_clips(input_path: Path) -> list[Path]:
    """根据输入路径类型，解析为 clip 目录列表。

    支持三种输入：
    - clip 目录（含 .mp4）→ [clip_dir]
    - scn 目录（含 clip* 子目录）→ [clip_dir, ...]
    - ep 目录（含 scn*/clip* 子目录）→ [clip_dir, ...]
    """
    input_path = input_path.resolve()

    if list(input_path.glob("*.mp4")):
        return [input_path]

    clip_dirs = sorted(input_path.glob("clip*"))
    if clip_dirs and any(list(d.glob("*.mp4")) for d in clip_dirs):
        return [d for d in clip_dirs if list(d.glob("*.mp4"))]

    clip_dirs = sorted(input_path.glob("scn*/clip*"))
    if clip_dirs:
        return [d for d in clip_dirs if list(d.glob("*.mp4"))]

    clip_dirs = sorted(input_path.glob("**/clip*"))
    return [d for d in clip_dirs if d.is_dir() and list(d.glob("*.mp4"))]


def parse_clip_identity(clip_dir: Path) -> dict:
    """从 clip 目录路径提取标识信息。

    目录结构: .../ep{NNN}/scn{NNN}/clip{NNN}/
    返回 {ep, scn, clip, clip_id, scene_id, label}
    """
    clip_dir = clip_dir.resolve()
    parts = clip_dir.parts

    ep = scn = clip = None
    for part in parts:
        if re.match(r"ep\d{3}", part):
            ep = part
        elif re.match(r"scn\d{3}", part):
            scn = part
        elif re.match(r"clip\d{3}", part):
            clip = part

    def to_id(name):
        if not name:
            return None
        m = re.match(r"([a-z]+)(\d+)", name)
        if m:
            return f"{m.group(1)}_{m.group(2)}"
        return name

    clip_id = to_id(clip)
    scene_id = to_id(scn)
    label = f"{ep}_{scn}_{clip}" if all([ep, scn, clip]) else clip_dir.name

    return {
        "ep": ep,
        "scn": scn,
        "clip": clip,
        "clip_id": clip_id,
        "scene_id": scene_id,
        "label": label,
    }


def build_output_path(identity: dict, output_dir: Path) -> Path:
    """构建镜像层级输出路径: output/ep{NNN}/_tmp/scn{NNN}/clip{NNN}/analysis.json"""
    ep = identity["ep"] or "unknown_ep"
    scn = identity["scn"] or "unknown_scn"
    clip = identity["clip"] or "unknown_clip"
    return output_dir / ep / "_tmp" / scn / clip / "analysis.json"


# ═══════════════════════ Step 1: Shot 切点检测 ═══════════════════════


def detect_shots(
    video_path: str,
    mode: str = "adaptive",
    threshold: float = 37.0,
    adaptive_threshold: float = 3.0,
    min_content_val: float = 15.0,
    window_width: int = 2,
    min_scene_sec: float = 1.0,
) -> dict:
    """对单个视频做 shot 切点检测，返回结构化结果。"""
    from scenedetect import open_video, SceneManager
    from scenedetect.detectors import AdaptiveDetector, ContentDetector

    video = open_video(str(video_path), backend="pyav")
    fps = video.frame_rate
    duration = video.duration.get_seconds()
    min_scene_len = max(1, int(fps * min_scene_sec))

    sm = SceneManager()
    if mode == "content":
        sm.add_detector(
            ContentDetector(threshold=threshold, min_scene_len=min_scene_len)
        )
    else:
        sm.add_detector(
            AdaptiveDetector(
                adaptive_threshold=adaptive_threshold,
                min_scene_len=min_scene_len,
                min_content_val=min_content_val,
                window_width=window_width,
            )
        )

    sm.detect_scenes(video, show_progress=False)
    scenes = sm.get_scene_list()

    shot_list = []
    for i, (start, end) in enumerate(scenes):
        shot_list.append(
            {
                "shot": i + 1,
                "start": round(start.get_seconds(), 3),
                "end": round(end.get_seconds(), 3),
                "start_timecode": start.get_timecode(),
                "end_timecode": end.get_timecode(),
                "duration": round(end.get_seconds() - start.get_seconds(), 3),
            }
        )

    return {
        "file": str(video_path),
        "fps": round(fps, 2),
        "duration": round(duration, 3),
        "mode": mode,
        "total_shots": len(scenes),
        "total_cuts": max(0, len(scenes) - 1),
        "cut_points": [s["start"] for s in shot_list[1:]],
        "shots": shot_list,
    }


def run_shot_detection(video_path: str) -> dict:
    """执行 shot 切点检测"""
    print(f"[Step 1] 正在检测 shot 切点: {Path(video_path).name}")
    result = detect_shots(
        video_path,
        mode=SCENE_DETECT_MODE,
        threshold=SCENE_DETECT_THRESHOLD,
        adaptive_threshold=SCENE_DETECT_ADAPTIVE_THRESHOLD,
        min_content_val=SCENE_DETECT_MIN_CONTENT_VAL,
        window_width=SCENE_DETECT_WINDOW_WIDTH,
        min_scene_sec=SCENE_DETECT_MIN_SCENE_SEC,
    )
    print(
        f"  → {result['total_shots']} 个 shot, "
        f"{result['total_cuts']} 个切点"
    )
    if result["cut_points"]:
        print(f"  → 切点位置: {result['cut_points']}s")
    return result


def load_shot_detection(scenes_path: str) -> dict:
    """从 JSON 文件加载预计算的 shot 检测结果"""
    data = json.loads(Path(scenes_path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        data = data[0]
    print(f"[Step 1] 从文件加载 shot 检测结果: {Path(scenes_path).name}")
    print(
        f"  → {data.get('total_shots', data.get('total_scenes', '?'))} 个 shot, "
        f"{data.get('total_cuts', '?')} 个切点"
    )
    # 兼容旧格式 key
    if "total_scenes" in data and "total_shots" not in data:
        data["total_shots"] = data.pop("total_scenes")
    return data


# ═══════════════════════ Step 2: Gemini 分析 ═══════════════════════


def compress_video(video_path: str) -> str | None:
    """上传前压缩视频以节省带宽。返回压缩文件路径，跳过时返回 None"""
    size_mb = Path(video_path).stat().st_size / (1024 * 1024)

    if not COMPRESS_ENABLED:
        print(f"  压缩已禁用，直接上传 ({size_mb:.1f} MB)")
        return None

    if size_mb < COMPRESS_SKIP_UNDER_MB:
        print(f"  文件较小 ({size_mb:.1f} MB < {COMPRESS_SKIP_UNDER_MB} MB)，跳过压缩")
        return None

    if shutil.which("ffmpeg") is None:
        print("  未找到 ffmpeg，跳过压缩")
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

    print(f"  正在压缩 ({size_mb:.1f} MB → {COMPRESS_RESOLUTION}p/{COMPRESS_FPS}fps)...")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode != 0:
        print(f"  压缩失败，使用原始文件: {proc.stderr.strip()[-200:]}")
        Path(out_path).unlink(missing_ok=True)
        return None

    out_mb = Path(out_path).stat().st_size / (1024 * 1024)
    elapsed = time.time() - t0
    print(f"  压缩完成: {size_mb:.1f} → {out_mb:.1f} MB ({elapsed:.1f}s)")
    return out_path


def upload_video(video_path: str, client, variant_label: str = "", max_retries: int = 3) -> object:
    """上传视频到 Gemini Files API，带重试（应对 SSL EOF 等瞬态网络错误）"""
    tag = f" [{variant_label}]" if variant_label else ""

    for attempt in range(1, max_retries + 1):
        try:
            print(f"  正在上传{tag}: {Path(video_path).name}" + (f" (重试 {attempt}/{max_retries})" if attempt > 1 else ""))
            video_file = client.files.upload(file=video_path)

            print(f"  等待 Gemini 处理{tag}...")
            while video_file.state.name == "PROCESSING":
                time.sleep(3)
                video_file = client.files.get(name=video_file.name)

            if video_file.state.name != "ACTIVE":
                raise RuntimeError(f"视频处理失败{tag}，状态: {video_file.state.name}")

            print(f"  上传完成{tag}: {video_file.name}")
            return video_file

        except Exception as e:
            if attempt < max_retries:
                wait = attempt * 3
                print(f"  上传失败{tag}，{wait}s 后重试: {e}")
                time.sleep(wait)
            else:
                raise


def _compress_and_upload_one(v: dict, client) -> dict | None:
    """压缩+上传单个变体，成功返回带 gemini_file 的 dict，失败返回 None。"""
    label = v["label"]
    path = str(v["path"])
    try:
        compressed = compress_video(path)
        upload_path = compressed or path
        gemini_file = upload_video(upload_path, client, variant_label=label)
        if compressed:
            Path(compressed).unlink(missing_ok=True)
        return {**v, "gemini_file": gemini_file}
    except Exception as e:
        print(f"  警告: 变体 {label} 上传失败，跳过: {e}")
        return None


def upload_variants(variants: list[dict], client) -> list[dict]:
    """并行压缩+上传所有变体。上传失败的变体会被移除并打印警告。"""
    workers = min(PHASE1_VARIANT_CONCURRENCY, len(variants))
    if workers <= 1:
        # 单变体走串行，省线程开销
        results = [_compress_and_upload_one(v, client) for v in variants]
    else:
        print(f"  并行上传 {len(variants)} 个变体（workers={workers}）")
        results = [None] * len(variants)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_compress_and_upload_one, v, client): i
                for i, v in enumerate(variants)
            }
            for fut in as_completed(futures):
                idx = futures[fut]
                results[idx] = fut.result()
    return [r for r in results if r is not None]




def analyze_with_gemini(
    video_files: list,
    prompt: str,
    clip_label: str,
    client,
    raw_output_dir: Path | None = None,
) -> dict:
    """调用 Gemini 分析视频变体组，返回解析后的 JSON。"""
    from google.genai import types

    config = types.GenerateContentConfig(
        temperature=GEMINI_TEMPERATURE,
        thinking_config=types.ThinkingConfig(thinking_level=GEMINI_THINKING_LEVEL),
        media_resolution=GEMINI_MEDIA_RESOLUTION,
    )

    n = len(video_files)
    print(
        f"[Step 2] 调用 Gemini 分析 {clip_label}（{n} 个变体, "
        f"模型: {GEMINI_MODEL}, thinking: {GEMINI_THINKING_LEVEL}）"
    )
    t0 = time.time()

    contents = video_files + [prompt]
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=config,
    )
    elapsed = time.time() - t0
    print(f"  Gemini 响应完成 ({elapsed:.1f}s)")

    # 检查空响应
    if response.text is None:
        raise ValueError("Gemini 返回空响应 (response.text is None)")

    raw = response.text.strip()

    # 保存原始响应到 clip 的输出目录旁（.md 后缀，因为 Gemini 返回 markdown 格式）
    save_dir = raw_output_dir or OUTPUT_DIR
    save_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    raw_path = save_dir / f"gemini-raw-{ts}.md"
    raw_path.write_text(raw, encoding="utf-8")
    print(f"  原始输出已保存: {raw_path}")

    # 清理 markdown 代码块包裹
    cleaned = raw
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
        cleaned = cleaned.rsplit("```", 1)[0]

    return json.loads(cleaned)


# ═══════════════════════ 分镜脚本工具 ═══════════════════════


def extract_clip_from_storyboard(
    storyboard_path: str, clip_id: str
) -> dict | None:
    """从 storyboard JSON 中提取指定 clip 的信息"""
    data = json.loads(Path(storyboard_path).read_text(encoding="utf-8"))
    scenes = data.get("scenes", [])
    for scene in scenes:
        for clip in scene.get("clips", []):
            if clip.get("clip_id") == clip_id:
                return {
                    "scene_id": scene.get("scene_id"),
                    "environment": scene.get("environment"),
                    "clip_id": clip["clip_id"],
                    "expected_duration": clip.get("expected_duration"),
                    "shots": clip.get("shots", []),
                }
    return None


def guess_storyboard_path(clip_dir: Path) -> str | None:
    """从 clip 目录路径向上查找对应的 storyboard.json"""
    clip_dir = clip_dir.resolve()
    for parent in clip_dir.parents:
        if parent.name.startswith("ep"):
            sb = parent / f"{parent.name}_storyboard.json"
            if sb.exists():
                return str(sb)
    return None


# ═══════════════════════ ep 级索引 ═══════════════════════


def generate_ep_index(output_dir: Path, ep_name: str) -> Path | None:
    """扫描 output/ep{NNN}/ 下所有 analysis.json，生成 ep 级汇总索引。"""
    ep_dir = output_dir / ep_name
    if not ep_dir.exists():
        return None

    analysis_files = sorted(ep_dir.glob("**/analysis.json"))
    if not analysis_files:
        return None

    clips = []
    for af in analysis_files:
        try:
            data = json.loads(af.read_text(encoding="utf-8"))
        except Exception:
            continue

        overall = data.get("overall", {})
        comparison = data.get("clip_comparison", {})
        best = comparison.get("best_overall", {})
        assembly = comparison.get("recommended_assembly", {})

        clips.append({
            "clip_label": data.get("clip_label"),
            "clip_id": data.get("clip_id"),
            "scene_id": data.get("scene_id"),
            "analysis_path": str(af.relative_to(output_dir)),
            "total_variants": len(data.get("variants", [])),
            "total_shots": overall.get("total_shots", len(data.get("shots", []))),
            "best_variant": best.get("variant"),
            "best_score": best.get("score"),
            "assembly_strategy": assembly.get("strategy"),
            "recommendation": overall.get("recommendation"),
            "summary": overall.get("summary", ""),
        })

    index = {
        "episode": ep_name,
        "total_clips": len(clips),
        "clips": clips,
    }

    index_path = ep_dir / f"{ep_name}_analysis_index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"  ep 索引已生成: {index_path}")
    return index_path


# ═══════════════════════ 单 clip 处理流程 ═══════════════════════


def process_single_clip(clip_dir: Path, args, clip_index: int = 0, total_clips: int = 1) -> dict | None:
    """封装单 clip 完整处理流程。返回结果摘要 dict，失败返回 None。"""
    clip_dir = Path(clip_dir).resolve()
    identity = parse_clip_identity(clip_dir)
    clip_label = identity["label"]
    progress_tag = f"[clip {clip_index}/{total_clips}]"

    print(f"\n{'='*60}")
    print(f"{progress_tag} 处理 clip: {clip_label}")
    print(f"  目录: {clip_dir}")

    # ── 发现变体 ──
    variants = discover_variants(clip_dir)
    if not variants:
        print(f"  警告: {clip_dir} 下没有 .mp4 文件，跳过")
        return None

    print(f"  发现 {len(variants)} 个变体: {', '.join(v['label'] for v in variants)}")

    # ── 输出路径（镜像层级）& 断点续传 ──
    output_dir = Path(args.output_dir) if args.output_dir else OUTPUT_DIR
    output_path = build_output_path(identity, output_dir)
    if args.skip_existing and output_path.exists():
        print(f"  跳过（已有结果）: {clip_label}")
        return {"clip_label": clip_label, "skipped": True}

    # ── API Key 检查 ──
    if not GEMINI_API_KEY:
        print("错误: 请设置 GEMINI_API_KEY（值使用 ChatFire key，环境变量或 .env 文件）", file=sys.stderr)
        return None

    # ── Step 1: Shot 切点检测（每个变体独立检测，并行）──
    if args.scenes:
        # 预计算模式：所有变体共享同一份切点（向后兼容）
        shared_detection = load_shot_detection(args.scenes)
        shot_detections = {v["label"]: shared_detection for v in variants}
    else:
        workers = min(PHASE1_VARIANT_CONCURRENCY, len(variants))
        if workers <= 1:
            shot_detections = {}
            for v in variants:
                print(f"  {progress_tag} {clip_label} - 检测 {v['label']} 切点...")
                shot_detections[v["label"]] = run_shot_detection(str(v["path"]))
        else:
            print(f"  {progress_tag} {clip_label} - 并行检测 {len(variants)} 个变体切点（workers={workers}）")
            shot_detections = {}
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(run_shot_detection, str(v["path"])): v["label"]
                    for v in variants
                }
                for fut in as_completed(futures):
                    label = futures[fut]
                    shot_detections[label] = fut.result()

    # ── 加载分镜脚本（可选）──
    storyboard_clip = None
    storyboard_path = args.storyboard

    if storyboard_path == "auto":
        storyboard_path = guess_storyboard_path(clip_dir)
        if storyboard_path:
            print(f"  自动定位分镜脚本: {Path(storyboard_path).name}")
        else:
            print("  未找到对应的分镜脚本，跳过匹配评分")

    if storyboard_path and storyboard_path != "auto":
        clip_id = args.clip_id or identity.get("clip_id")
        if clip_id:
            storyboard_clip = extract_clip_from_storyboard(storyboard_path, clip_id)
            if storyboard_clip:
                shots_count = len(storyboard_clip.get("shots", []))
                print(f"  加载分镜脚本: {clip_id} ({shots_count} shots)")
            else:
                print(f"  警告: 在脚本中未找到 {clip_id}，跳过匹配评分")
        else:
            print("  警告: 无法推断 clip_id，跳过匹配评分（可用 --clip-id 指定）")

    # ── Step 2: 上传变体 + Gemini 分析 ──
    from google import genai as google_genai

    if GEMINI_BASE_URL:
        from google.genai import types as genai_types
        client = google_genai.Client(
            api_key=GEMINI_API_KEY,
            http_options=genai_types.HttpOptions(base_url=GEMINI_BASE_URL),
        )
    else:
        client = google_genai.Client(api_key=GEMINI_API_KEY)

    uploaded = upload_variants(variants, client)
    if not uploaded:
        print(f"  错误: 所有变体上传失败，跳过 {clip_label}")
        return None

    # 原始响应保存到 clip 输出目录旁
    raw_output_dir = output_path.parent
    prompt = build_phase1_prompt(uploaded, shot_detections, storyboard_clip)
    video_files = [v["gemini_file"] for v in uploaded]
    analysis = analyze_with_gemini(video_files, prompt, clip_label, client, raw_output_dir)

    # ── 组装最终输出 ──
    variants_info = []
    for v in uploaded:
        vpath = v["path"]
        meta = get_video_meta(vpath)
        variants_info.append({
            "label": v["label"],
            "file": vpath.name,
            "path": str(vpath),
            "duration": meta["duration"],
            "fps": meta["fps"],
        })

    result = {
        "clip_label": clip_label,
        "episode": identity["ep"],
        "scene": identity["scn"],
        "clip": identity["clip"],
        "clip_id": identity["clip_id"],
        "scene_id": identity["scene_id"],
        "variants": variants_info,
        "shot_detection": {
            label: {
                "mode": sd.get("mode"),
                "total_shots": sd.get("total_shots"),
                "total_cuts": sd.get("total_cuts"),
                "cut_points": sd.get("cut_points", []),
            }
            for label, sd in shot_detections.items()
        },
        "has_storyboard": storyboard_clip is not None,
        **analysis,
    }

    # ── 保存 ──
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # ── 打印摘要 ──
    overall = analysis.get("overall", {})
    shots = analysis.get("shots", [])
    comparison = analysis.get("clip_comparison", {})

    print(f"\n{'─'*40}")
    print(f"分析完成: {clip_label}")
    print(f"  变体数: {len(uploaded)}")
    print(f"  镜头数: {len(shots)}")

    if comparison:
        best = comparison.get("best_overall", {})
        if best:
            print(f"  最佳变体: {best.get('variant', '?')} (score: {best.get('score', '?')})")
            strategy = comparison.get("recommended_assembly", {}).get("strategy", "?")
            print(f"  组装策略: {strategy}")
    else:
        print(f"  质量评分: {overall.get('best_variant_quality_score', '?')}/10")

    print(f"  推荐等级: {overall.get('recommendation', '?')}")
    print(f"  输出: {output_path}")
    print(f"  概要: {overall.get('summary', '')}")

    return {"clip_label": clip_label, "ep": identity["ep"], "skipped": False}


# ═══════════════════════ 主流程 ═══════════════════════


def main():
    parser = argparse.ArgumentParser(
        description="视频分镜分析：clip 组对比分析（PySceneDetect + Gemini）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 单 clip 目录
  python analyze_video.py input/ep001/scn001/clip001

  # scn 目录（处理所有 clip）
  python analyze_video.py input/ep001/scn001

  # ep 目录（处理所有 scn/clip）
  python analyze_video.py input/ep001

  # 指定输出目录 + 断点续传
  python analyze_video.py input/ep001 -o results/ --skip-existing

  # 传入预计算切镜 + 自动查找分镜脚本
  python analyze_video.py input/ep001/scn001/clip001 --scenes scenes.json --storyboard auto
        """,
    )
    parser.add_argument("input_path", help="输入路径（clip/scn/ep 目录）")
    parser.add_argument(
        "--scenes", help="预计算的 shot 切点 JSON（不传则自动检测）"
    )
    parser.add_argument(
        "--storyboard",
        help='分镜脚本 JSON 路径（传 "auto" 自动查找）',
    )
    parser.add_argument(
        "--clip-id",
        help='脚本中的 clip_id（如 clip_001，不传则从目录路径推断）',
    )
    parser.add_argument(
        "-o", "--output-dir",
        help="输出目录（默认由 OUTPUT_DIR 环境变量或 default.env 控制）",
    )
    parser.add_argument(
        "--skip-existing", action="store_true",
        help="如果输出文件已存在则跳过（用于断点续传）",
    )
    args = parser.parse_args()

    input_path = Path(args.input_path)
    if not input_path.exists():
        print(f"错误: 找不到路径: {input_path}", file=sys.stderr)
        sys.exit(1)

    # ── 发现所有 clip 目录 ──
    clips = discover_clips(input_path)
    if not clips:
        print(f"错误: 在 {input_path} 下未找到任何包含 .mp4 的 clip 目录", file=sys.stderr)
        sys.exit(1)

    print(f"发现 {len(clips)} 个 clip 目录")
    for c in clips:
        print(f"  {c}")

    # ── 处理所有 clip（并行）──
    success = 0
    failed = 0
    skipped = 0
    ep_set = set()

    clip_workers = min(PHASE1_CLIP_CONCURRENCY, len(clips))
    if clip_workers <= 1:
        # 单 clip 或并发=1，串行执行
        for i, clip_dir in enumerate(clips, 1):
            try:
                result = process_single_clip(clip_dir, args, clip_index=i, total_clips=len(clips))
                if result is None:
                    failed += 1
                elif result.get("skipped"):
                    skipped += 1
                else:
                    success += 1
                    if result.get("ep"):
                        ep_set.add(result["ep"])
            except Exception as e:
                print(f"\n错误: 处理 {clip_dir} 失败: {e}", file=sys.stderr)
                failed += 1
    else:
        print(f"\n并行处理 {len(clips)} 个 clip（workers={clip_workers}）")
        with ThreadPoolExecutor(max_workers=clip_workers) as pool:
            futures = {
                pool.submit(
                    process_single_clip, clip_dir, args,
                    clip_index=i, total_clips=len(clips),
                ): clip_dir
                for i, clip_dir in enumerate(clips, 1)
            }
            for fut in as_completed(futures):
                clip_dir = futures[fut]
                try:
                    result = fut.result()
                    if result is None:
                        failed += 1
                    elif result.get("skipped"):
                        skipped += 1
                    else:
                        success += 1
                        if result.get("ep"):
                            ep_set.add(result["ep"])
                except Exception as e:
                    print(f"\n错误: 处理 {clip_dir} 失败: {e}", file=sys.stderr)
                    failed += 1

    # ── 生成 ep 级索引 ──
    output_dir = Path(args.output_dir) if args.output_dir else OUTPUT_DIR
    for ep_name in sorted(ep_set):
        generate_ep_index(output_dir, ep_name)

    # ── 总结 ──
    print(f"\n{'='*60}")
    print(f"全部完成: {success} 成功, {skipped} 跳过, {failed} 失败 / 共 {len(clips)} 个 clip")


if __name__ == "__main__":
    main()
