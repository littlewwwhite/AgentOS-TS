#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
角色音色并行生成脚本（视频截取模式）

流程：
  1. 提交视频生成任务（videoCreate），以 voice_text 作为提示词
  2. 轮询任务状态（videoCreateGet），等待视频生成完成
  3. 下载生成的视频文件
  4. 用 ffmpeg 提取全音轨 → demucs 分离人声，保存为 voice.mp3
  5. 上传音频文件到 COS（腾讯云对象存储）
  6. 清理临时视频文件

输入 config.json 格式：
{
  "actors": [
    {
      "actor_id":   "xxx",
      "name":       "角色名",
      "voice_text": "视频生成提示词（用于驱动包含角色语音的视频）",
      "voice_desc": "可选描述",
      "output_path": "/abs/path/to/voice.mp3"
    }
  ]
}

输出（stdout 最后一行 JSON）：
{
  "results": {
    "actor_id_1": {
      "local_path": "/abs/path/to/voice.mp3",
      "cos_url": "https://..."
    },
    ...
  },
  "errors":  ["actor_id_2 失败原因", ...]
}

用法:
  python generate_voices.py --config /tmp/voice_config.json

依赖:
  - ffmpeg（系统已安装）
  - ~/.claude/skills/awb-login/scripts/auth.py（复用平台认证）
"""

import sys, os, json, time, argparse, subprocess, threading, uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
# Windows UTF-8
if sys.platform == 'win32':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    elif hasattr(sys.stdout, 'buffer'):
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# ── 复用认证模块 ────────────────────────────────────────────────────────────
from common_config import get_shared_auth_path
sys.path.insert(0, str(get_shared_auth_path()))
import auth

# ── 人声提取公共模块 ──────────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from common_sep_voice import sep_voice_from_video
from common_create_subjects import upload_to_cos

# ── 平台常量 ─────────────────────────────────────────────────────────────────
BASE_URL            = os.environ.get("AWB_BASE_URL", "https://animeworkbench.lingjingai.cn")
DEFAULT_VIDEO_MODEL = "JiMeng3_5_Pro_VideoCreate"  # 视频生成模型编码
DEFAULT_VIDEO_MODEL_GROUP = "JiMeng3_5_Pro_VideoCreate_Group"

_log_lock = threading.Lock()


def log(msg):
    with _log_lock:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


# ── 视频任务提交 ──────────────────────────────────────────────────────────────

def submit_video_task(text: str, max_retries: int = 3):
    """提交视频生成任务，返回 taskId（失败返回 None）。

    POST /api/material/creation/videoCreate
    Body: {"modelCode": ..., "taskPrompt": text, "promptParams": {...}}
    """
    payload = {
        "modelCode":  DEFAULT_VIDEO_MODEL,
        "modelGroupCode": DEFAULT_VIDEO_MODEL_GROUP,
        "taskPrompt": text,
        "promptParams": {
            "quality":        "720",
            "generated_time": "5",
            "frames": [
                {
                    "text": text,
                    "url":  "",
                    "time": "5",
                    "_id":  str(uuid.uuid4()),
                }
            ],
            "prompt":          "",
            "ratio":           "16:9",
            "multi_param":     [],
            "richTaskPrompt":  "",
        },
        "bizScenarioParams": None,
    }
    for attempt in range(1, max_retries + 1):
        try:
            result = auth.api_request(
                f"{BASE_URL}/api/material/creation/videoCreate",
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                method="POST",
            )
            task_id = result.get("data")
            if task_id:
                log(f"  ✓ 视频任务已提交: {task_id}")
                return task_id
            log(f"  ⚠ 视频提交返回无 data ({attempt}/{max_retries}): {str(result)[:200]}")
        except Exception as e:
            log(f"  ⚠ 视频提交异常 ({attempt}/{max_retries}): {e}")
        if attempt < max_retries:
            time.sleep(2)
    log(f"  ❌ 视频提交失败，已重试 {max_retries} 次")
    return None


# ── 视频任务轮询 ──────────────────────────────────────────────────────────────

def poll_video_task(task_id: str, timeout: int = 600, label: str = ""):
    """轮询视频任务直到完成，返回视频文件 URL 或 None。

    GET /api/material/creation/videoCreateGet?taskId=...
    """
    start_time       = time.time()
    consecutive_errs = 0
    max_errs         = 10
    lbl              = f"[{label}] " if label else ""

    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            log(f"  ❌ {lbl}视频生成超时（{timeout}秒）")
            return None
        try:
            result = auth.api_request(
                f"{BASE_URL}/api/material/creation/videoCreateGet?taskId={task_id}",
                method="GET",
            )
            if result.get("code") != 200:
                consecutive_errs += 1
                log(f"  ⚠ {lbl}接口错误 ({consecutive_errs}/{max_errs}): {result.get('msg')}")
                if consecutive_errs >= max_errs:
                    return None
                time.sleep(5)
                continue

            consecutive_errs = 0
            data   = result.get("data", {})
            status = data.get("taskStatus", "UNKNOWN")

            if status == "SUCCESS":
                files = data.get("resultFileList", [])
                if files:
                    log(f"  ✓ {lbl}视频生成成功")
                    return files[0]
                log(f"  ⚠ {lbl}视频成功但无文件 URL")
                return None
            elif status in ("FAIL", "FAILED"):
                log(f"  ❌ {lbl}视频生成失败: {data.get('errorMsg', '未知')}")
                return None
            else:
                queue_num = data.get("taskQueueNum", "-")
                log(f"  ⏳ {lbl}状态: {status}, 队列: {queue_num}, 已等待: {elapsed:.0f}s")
            time.sleep(5)
        except Exception as e:
            consecutive_errs += 1
            log(f"  ⚠ {lbl}查询异常 ({consecutive_errs}/{max_errs}): {e}")
            if consecutive_errs >= max_errs:
                return None
            time.sleep(5)


# ── 视频下载 ──────────────────────────────────────────────────────────────────

def download_video(url: str, output_path: Path) -> bool:
    """下载视频文件到本地，成功返回 True。"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["curl", "-s", "-L", "-o", str(output_path), url],
            check=True, timeout=120,
        )
        if output_path.exists() and output_path.stat().st_size > 10_000:
            log(f"  ✓ 视频已下载: {output_path.name} ({output_path.stat().st_size // 1024}KB)")
            return True
        log(f"  ❌ 视频下载后文件过小或不存在")
    except Exception as e:
        log(f"  ❌ 视频下载失败: {e}")
    return False


# ── 单角色音色生成 ────────────────────────────────────────────────────────────

def generate_voice_for_char(item: dict) -> tuple:
    """
    为单个角色生成音色：提交视频 → 轮询 → 下载视频 → 提取音频 → 保存 mp3 → 上传 COS。

    item 字段：actor_id, name, voice_text, voice_desc, output_path
    返回 (actor_id, voice_path_or_None, cos_url_or_None)
    """
    actor_id    = item["actor_id"]
    actor_name  = item["actor_name"]
    voice_text  = item.get("voice_text", "")
    voice_desc  = item.get("voice_desc", "")
    output_path = Path(item["output_path"])

    log(f"── 开始生成音色: {actor_name} ({actor_id})")

    # 断点续传：已有音频直接返回
    if output_path.exists() and output_path.stat().st_size > 1000:
        log(f"  ✓ 音色已存在，复用: {output_path}")
        # 尝试上传到 COS（如果之前未上传）
        cos_url, _ = upload_to_cos(str(output_path), scene_type="agent-material")
        if cos_url:
            log(f"  ✓ 音色已上传到 COS: {cos_url}")
        return actor_id, str(output_path), cos_url

    if not voice_text and not voice_desc:
        log(f"  ⚠ {actor_name} 无 voice_text 和 voice_desc，跳过音色生成")
        return actor_id, None, None

    # 临时视频文件路径
    video_path = output_path.with_suffix(".tmp.mp4")

    try:
        # Step 1: 提交视频任务
        task_id = submit_video_task(voice_desc+voice_text)
        if not task_id:
            log(f"  ❌ {actor_name} 视频任务提交失败")
            return actor_id, None, None

        # Step 2: 轮询视频生成结果
        video_url = poll_video_task(task_id, label=actor_name)
        if not video_url:
            log(f"  ❌ {actor_name} 视频生成失败")
            return actor_id, None, None

        # Step 3: 下载视频
        if not download_video(video_url, video_path):
            log(f"  ❌ {actor_name} 视频下载失败")
            return actor_id, None, None

        # Step 4: 提取人声（委托 common_sep_voice，中间文件自动清理）
        try:
            sep_voice_from_video(
                input_video=str(video_path),
                output_mp3=str(output_path),
            )
        except Exception as e:
            log(f"  ❌ {actor_name} 音频提取失败: {e}")
            return actor_id, None, None
        if not output_path.exists() or output_path.stat().st_size < 1000:
            log(f"  ❌ {actor_name} 音频文件异常（过小或不存在）")
            return actor_id, None, None

        log(f"  ✅ {actor_name} 音色生成完成: {output_path}")

        # Step 5: 上传到 COS
        cos_url, _ = upload_to_cos(str(output_path), scene_type="agent-material")
        if cos_url:
            log(f"  ✅ {actor_name} 音色已上传到 COS: {cos_url}")
        else:
            log(f"  ⚠ {actor_name} 音色上传 COS 失败，但本地文件已保存")

        return actor_id, str(output_path), cos_url

    finally:
        # 清理临时视频文件
        if video_path.exists():
            try:
                video_path.unlink()
                log(f"  🗑 临时视频已清理: {video_path.name}")
            except Exception:
                pass

if __name__ == "__main__":
    aa = {
        "actor_id": "act_001",
        "actor_name": "雨璞",
        "voice_text": "山河辽阔，风云变幻，前路漫漫，唯有砥砺前行。",
        "voice_desc": "声线清冷通透，音调偏中高，语速舒缓克制。质感如被薄霜洗过的冷玉，平稳中透着仙家的孤傲与疏离，余韵冷冽而坚定。恰似深秋高空掠过的一道清风，寒凉又凛然。",
        "output_path": os.path.join(os.environ.get("PROJECT_DIR", "."), "output", "actors", "雨璞_act_001.mp3"),
    }
    actor_id, voice_path, cos_url = generate_voice_for_char(aa)
    print(f"Result: actor_id={actor_id}, voice_path={voice_path}, cos_url={cos_url}")