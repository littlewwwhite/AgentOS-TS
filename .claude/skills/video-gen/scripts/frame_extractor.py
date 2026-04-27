#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
frame_extractor.py — 视频末镜头首帧提取与人脸模糊处理

功能：
  1. 用 ffmpeg 场景检测找到视频中最后一个镜头的起始时间
  2. 精确跳到该时间点提取第一帧
  3. 检测人脸区域，仅对人脸部分高斯模糊，保存为 png

可作为模块导入，也可独立运行。

用法（CLI）：
  python frame_extractor.py <video_path> [--output <output.png>]
                            [--blur-radius 25] [--scene-threshold 0.3]
                            [--face-expand 0.3]

示例：
  python frame_extractor.py ep001_scn001_clip001.mp4
  python frame_extractor.py ep001_scn001_clip001.mp4 --output first_frame.png --blur-radius 30
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any
from typing import List, Optional, Tuple

# 配置 UTF-8 输出
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


DEFAULT_FRAME_DESCRIPTION_MODEL = (
    os.environ.get("FRAME_DESCRIPTION_MODEL")
    or os.environ.get("VISION_REVIEW_MODEL")
    or "gemini-3.1-pro-preview"
)

FRAME_DESCRIPTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "description": {"type": "string"},
    },
    "required": ["description"],
    "additionalProperties": False,
}


# ============================================================
# 场景检测
# ============================================================

def detect_last_shot_start(
    video_path: str,
    scene_threshold: float = 0.3,
) -> Optional[float]:
    """通过 ffmpeg 场景检测找到视频中最后一个镜头的起始时间。

    原理：ffmpeg select 滤镜检测帧间亮度差，差值超过阈值即判定为镜头切换。
    取所有切换时间戳中最大的一个，即最后一次切换（最后一个镜头的起点）。

    Args:
        video_path:       视频文件路径
        scene_threshold:  场景切换灵敏度 (0~1)，值越小越灵敏，默认 0.3

    Returns:
        最后一个镜头的起始时间（秒）；
        整个视频只有一个镜头时返回 0.0；
        ffmpeg 调用失败返回 None
    """
    if not os.path.exists(video_path):
        print(f"[ERROR] 视频文件不存在: {video_path}", file=sys.stderr)
        return None

    try:
        result = subprocess.run(
            [
                'ffmpeg', '-i', video_path,
                '-vf', f"select='gt(scene,{scene_threshold})',showinfo",
                '-vsync', 'vfr', '-f', 'null', '-',
            ],
            capture_output=True, text=True, timeout=60,
        )
        combined = result.stderr + result.stdout
        timestamps = [float(m) for m in re.findall(r'pts_time:([\d.]+)', combined)]

        if timestamps:
            last_cut = max(timestamps)
            print(f"  [SCENE] 检测到 {len(timestamps)} 次镜头切换，"
                  f"最后一个镜头起始: {last_cut:.2f}s")
            return last_cut
        else:
            print(f"  [SCENE] 未检测到镜头切换（单镜头），起始: 0.0s")
            return 0.0

    except FileNotFoundError:
        print("[ERROR] 未找到 ffmpeg，请先安装: brew install ffmpeg", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print("[ERROR] ffmpeg 场景检测超时", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[ERROR] 场景检测异常: {e}", file=sys.stderr)
        return None


# ============================================================
# 人脸检测 + 局部模糊
# ============================================================

def _ensure_cv2() -> None:
    """确保 opencv-python 已安装，缺失时自动 pip 安装。"""
    try:
        import cv2  # noqa: F401
    except ImportError:
        print("[INFO] opencv-python 未安装，正在自动安装...", file=sys.stderr)
        subprocess.run(
            [sys.executable, '-m', 'pip', 'install', 'opencv-python', '-q'],
            check=True,
        )
        print("[INFO] opencv-python 安装完成", file=sys.stderr)


def _detect_faces(img_path: str) -> List[Tuple[int, int, int, int]]:
    """使用 OpenCV Haar 级联检测图片中的人脸。

    Returns:
        人脸矩形列表 [(x, y, w, h), ...]；无人脸时返回空列表。
    """
    import cv2

    img = cv2.imread(img_path)
    if img is None:
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    face_cascade = cv2.CascadeClassifier(cascade_path)

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(30, 30),
    )
    if len(faces) == 0:
        return []
    return [(int(x), int(y), int(w), int(h)) for x, y, w, h in faces]


def blur_faces_only(
    img_path: str,
    output_path: str,
    blur_radius: int = 25,
    face_expand: float = 0.3,
) -> Tuple[str, int]:
    """仅对图片中的人脸区域做高斯模糊，其余部分保持原样。

    Args:
        img_path:     输入图片路径（png/jpg 等）
        output_path:  输出 png 路径
        blur_radius:  人脸区域高斯模糊半径，默认 25
        face_expand:  人脸矩形向外扩展比例，默认 0.3（扩展 30% 以覆盖发际线/下巴）

    Returns:
        (output_path, face_count) — 处理后的文件路径 + 检测到的人脸数量。
        无人脸时直接保存原图（不做任何模糊），face_count=0。
    """
    from PIL import Image, ImageFilter

    _ensure_cv2()

    img = Image.open(img_path)
    W, H = img.size
    faces = _detect_faces(img_path)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    if not faces:
        # 未检测到人脸 → 保存原图，不做任何模糊
        img.save(output_path, 'png')
        print(f"  [FACE]  未检测到人脸，保存原图: {output_path}")
        return output_path, 0

    # 对每张人脸区域单独模糊
    result = img.copy()
    for x, y, w, h in faces:
        pad_x = int(w * face_expand)
        pad_y = int(h * face_expand)
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(W, x + w + pad_x)
        y2 = min(H, y + h + pad_y)

        face_crop = result.crop((x1, y1, x2, y2))
        blurred_face = face_crop.filter(ImageFilter.GaussianBlur(radius=blur_radius))
        result.paste(blurred_face, (x1, y1))

    result.save(output_path, 'png')
    print(f"  [FACE]  检测到 {len(faces)} 张人脸，已局部模糊: {output_path}  "
          f"(blur_radius={blur_radius}, expand={face_expand})")
    return output_path, len(faces)


# ============================================================
# 画面描述
# ============================================================


def _build_frame_description_prompt(
    last_shot_prompt: str,
    character_names: List[str],
) -> str:
    chars_text = "、".join(character_names) if character_names else "（无指定人物）"
    return f"""你是一个专业的视频画面分析师。下面是一个视频片段最后一个镜头的截帧画面。

该镜头的提示词（描述这个镜头的内容）：
{last_shot_prompt}

画面中涉及的人物：{chars_text}

请根据上述信息，仔细观察画面，用中文详细描述：
1. 每个人物在画面中的具体位置（左/中/右、前景/背景、远近）
2. 每个人物的姿态、动作和表情
3. 画面整体的构图和场景状态（光线、氛围、背景元素）

要求：
- 描述简洁准确，重点突出人物和动作
- 字数控制在 150 字以内
- 只输出 JSON 对象，字段为 description"""


def _frame_description_model(config: dict | None) -> str:
    if not config:
        return DEFAULT_FRAME_DESCRIPTION_MODEL
    return config.get("model") or DEFAULT_FRAME_DESCRIPTION_MODEL


def _read_frame_description_response(response_path: Path) -> str:
    try:
        response = json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli frame description response envelope: {response_path}") from exc

    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message") or "aos-cli frame description failed")

    output = response.get("output") or {}
    if output.get("kind") != "json":
        raise RuntimeError(f"aos-cli response output.kind mismatch: expected json, got {output.get('kind')}")

    data: Any
    if "data" in output:
        data = output["data"]
    elif "text" in output:
        data = json.loads(str(output["text"]).strip())
    else:
        raise RuntimeError("aos-cli frame description response missing output.data")

    if not isinstance(data, dict):
        raise RuntimeError("aos-cli frame description output.data must be an object")
    description = data.get("description")
    if not isinstance(description, str) or not description.strip():
        raise RuntimeError("aos-cli frame description output missing description")
    return description.strip()


def describe_frame_with_aos_cli(
    img_path: str,
    last_shot_prompt: str,
    character_names: List[str],
    config: dict | None = None,
) -> Optional[str]:
    """Describe a continuity frame through aos-cli vision.review."""
    path = Path(img_path)
    if not path.exists():
        print(f"[WARN] describe_frame_with_aos_cli: 图片不存在 {img_path}", file=sys.stderr)
        return None

    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": "video-gen.frame.describe",
        "capability": "vision.review",
        "modelPolicy": {"model": _frame_description_model(config)},
        "input": {
            "content": {
                "prompt": _build_frame_description_prompt(last_shot_prompt, character_names),
                "images": [path.resolve().as_uri()],
            }
        },
        "output": {"kind": "json", "schema": FRAME_DESCRIPTION_SCHEMA},
        "options": {"temperature": 0.2},
    }

    try:
        with tempfile.TemporaryDirectory(prefix="video-gen-frame-desc-aos-cli-") as tmp:
            tmp_dir = Path(tmp)
            request_path = tmp_dir / "request.json"
            response_path = tmp_dir / "response.json"
            request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
            completed = aos_cli_model_run(request_path, response_path, cwd=Path.cwd())
            if completed.returncode != 0:
                print(
                    f"[WARN] aos-cli 画面描述失败: {completed.stderr or completed.returncode}",
                    file=sys.stderr,
                )
                return None
            if not response_path.exists():
                print("[WARN] aos-cli 未写入画面描述响应 envelope", file=sys.stderr)
                return None
            description = _read_frame_description_response(response_path)
            print(f"  [DESC]  画面描述生成完成 ({len(description)} 字)")
            return description
    except Exception as e:
        print(f"[WARN] aos-cli 画面描述失败: {e}", file=sys.stderr)
        return None


# ============================================================
# 帧提取 + 人脸模糊（主流程）
# ============================================================

def extract_last_shot_first_frame_blurred(
    video_path: str,
    output_path: Optional[str] = None,
    blur_radius: int = 25,
    scene_threshold: float = 0.3,
    face_expand: float = 0.3,
    blur_faces: bool = True,
) -> Optional[str]:
    """提取视频中最后一个镜头的首帧，可选仅对人脸区域高斯模糊后保存为 png。

    流程：
      1. detect_last_shot_start() 用场景检测找到最后一个镜头的起始时间
      2. ffmpeg 精确跳到该时间点，提取第一帧（-ss 在 -i 之后确保精度）
      3. blur_faces=True 时：blur_faces_only() 检测人脸并局部模糊，保存为 png
         blur_faces=False 时：直接将原始帧作为输出（不做任何模糊处理）

    Args:
        video_path:       视频文件路径
        output_path:      输出 png 路径；未传入时生成临时文件
        blur_radius:      人脸区域高斯模糊半径，默认 25（仅 blur_faces=True 时生效）
        scene_threshold:  场景检测阈值，默认 0.3
        face_expand:      人脸矩形扩展比例，默认 0.3（仅 blur_faces=True 时生效）
        blur_faces:       是否对人脸区域做高斯模糊，默认 True；即梦 SD2.0 使用 True，可灵使用 False

    Returns:
        输出 png 文件的绝对路径，失败返回 None
    """
    try:
        from PIL import Image  # noqa: F401 — 提前检查 Pillow
    except ImportError:
        print("[ERROR] PIL 未安装，请执行: pip install Pillow", file=sys.stderr)
        return None

    # Step 1: 检测最后一个镜头的起始时间
    timestamp = detect_last_shot_start(video_path, scene_threshold)
    if timestamp is None:
        return None

    # 确定输出路径，并将临时原始帧放在同一目录下
    if output_path is None:
        output_path = os.path.splitext(video_path)[0] + '_last_shot_blur.png'

    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)
    tmp_png = os.path.join(out_dir, os.path.basename(output_path).replace('.png', '_raw.png'))
    try:
        # Step 2: 精确提取该时间点的首帧
        if timestamp > 0:
            ffmpeg_cmd = [
                'ffmpeg', '-i', video_path,
                '-ss', f'{timestamp:.3f}',
                '-frames:v', '1', '-q:v', '2', '-y', tmp_png,
            ]
            seek_desc = f"timestamp={timestamp:.2f}s（最后镜头首帧）"
        else:
            ffmpeg_cmd = [
                'ffmpeg', '-i', video_path,
                '-frames:v', '1', '-q:v', '2', '-y', tmp_png,
            ]
            seek_desc = "首帧（单镜头视频）"

        result = subprocess.run(ffmpeg_cmd, capture_output=True, timeout=30)
        if result.returncode != 0 or not os.path.exists(tmp_png):
            print(f"[ERROR] ffmpeg 帧提取失败 ({seek_desc}):\n"
                  f"  {result.stderr.decode()[:300]}", file=sys.stderr)
            return None

        print(f"  [FRAME] 已提取帧: {seek_desc}")

        # Step 3: 根据 blur_faces 决定是否对人脸区域模糊
        if blur_faces:
            blur_faces_only(
                img_path=tmp_png,
                output_path=output_path,
                blur_radius=blur_radius,
                face_expand=face_expand,
            )
        else:
            # 不做模糊，直接将原始帧复制为输出文件
            import shutil
            shutil.copy2(tmp_png, output_path)
            print(f"  [FRAME] 跳过人脸模糊（非即梦模型），原始帧保存: {output_path}")

        return output_path

    except Exception as e:
        print(f"[ERROR] 帧提取异常: {e}", file=sys.stderr)
        return None


# ============================================================
# 兼容旧接口（batch_generate.py 内部调用）
# ============================================================

def extract_last_frame_blurred(
    video_path: str,
    blur_radius: int = 25,
    scene_threshold: float = 0.3,
    output_path: Optional[str] = None,
) -> Optional[str]:
    """兼容旧接口，实际行为等同于 extract_last_shot_first_frame_blurred：
    提取视频中最后一个镜头的首帧（非视频尾帧），仅对人脸区域高斯模糊。

    Args:
        video_path:      视频文件路径
        blur_radius:     人脸区域高斯模糊半径，默认 25
        scene_threshold: 场景检测阈值，默认 0.3
        output_path:     指定输出路径；未传入时生成临时文件
    """
    return extract_last_shot_first_frame_blurred(
        video_path=video_path,
        output_path=output_path,
        blur_radius=blur_radius,
        scene_threshold=scene_threshold,
    )


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="视频末镜头首帧提取与人脸模糊处理",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 直接处理视频，输出到同目录
  python frame_extractor.py video.mp4

  # 指定输出路径和模糊强度
  python frame_extractor.py video.mp4 --output out.png --blur-radius 30

  # 调高场景检测灵敏度（检测更细微的切换）
  python frame_extractor.py video.mp4 --scene-threshold 0.2

  # 扩大人脸检测框（默认 0.3，即向外扩展 30%）
  python frame_extractor.py video.mp4 --face-expand 0.5
        """,
    )
    parser.add_argument('video_path', help='输入视频文件路径')
    parser.add_argument('--output', '-o', default=None,
                        help='输出 png 文件路径（默认: 与视频同目录，同名加 _last_shot_blur.png 后缀）')
    parser.add_argument('--blur-radius', type=int, default=25,
                        help='人脸区域高斯模糊半径，默认 25')
    parser.add_argument('--scene-threshold', type=float, default=0.3,
                        help='场景切换检测阈值 (0~1)，默认 0.3，越小越灵敏')
    parser.add_argument('--face-expand', type=float, default=0.3,
                        help='人脸矩形扩展比例，默认 0.3（扩展 30%% 以覆盖发际线/下巴）')
    args = parser.parse_args()

    if not os.path.exists(args.video_path):
        print(f"[ERROR] 视频文件不存在: {args.video_path}", file=sys.stderr)
        sys.exit(1)

    # output_path=None 时由 extract_last_shot_first_frame_blurred 自动推导（与视频同目录）
    output_path = args.output

    print(f"{'='*50}")
    print(f"输入: {args.video_path}")
    print(f"输出: {output_path or '（自动推导，与视频同目录）'}")
    print(f"blur_radius={args.blur_radius}  scene_threshold={args.scene_threshold}  "
          f"face_expand={args.face_expand}")
    print(f"{'='*50}")

    result = extract_last_shot_first_frame_blurred(
        video_path=args.video_path,
        output_path=output_path,
        blur_radius=args.blur_radius,
        scene_threshold=args.scene_threshold,
        face_expand=args.face_expand,
    )

    if result:
        print(f"\n[OK] 完成: {result}")
        sys.exit(0)
    else:
        print("\n[FAIL] 处理失败", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
