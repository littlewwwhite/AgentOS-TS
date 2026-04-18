#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common_image_api.py - 图片生成平台 API 封装

封装 animeworkbench 平台的图片生成接口，供 generate_characters / generate_scenes /
generate_props 等脚本统一调用。

提供:
  submit_image_task(model_code, prompt, params, max_retries=3) -> taskId | None
  poll_image_task(task_id, timeout=600, label="")             -> {"result": [...], "show": [...]} | None
  download_image(url, output_path)                            -> path | None
"""

import json, os, sys, time, subprocess, uuid
from pathlib import Path

# ── auth 模块（awb-login skill 提供）────────────────────────────────────
from common_config import get_shared_auth_path
sys.path.insert(0, str(get_shared_auth_path()))
import auth

# ── 平台常量 ────────────────────────────────────────────────────────────────
BASE_URL      = os.environ.get("AWB_BASE_URL", "https://animeworkbench.lingjingai.cn")
DEFAULT_MODEL = "Nano_Banana_ImageCreate"


class InsufficientCreditsError(Exception):
    """Raised when AWB returns code 1007 (insufficient credits).

    Callers should treat this as a fatal, non-retryable error and stop all
    pending submissions immediately.
    """


def submit_image_task(prompt, params, model_code="Nano_Banana_ImageCreate", max_retries=3, model_group_code="Nano_Banana_ImageCreate_Group_Discount"):
    """提交图片生成任务，返回 taskId，失败返回 None。

    Special error handling:
      - code 1007: raises InsufficientCreditsError immediately (no retry)
      - code 6003: duplicate submission detected; returns None without retrying
      - other non-success codes: normal retry up to max_retries
    """
    payload = {
        "modelCode":    model_code,
        "modelGroupCode": model_group_code,
        "taskPrompt":   prompt,
        "promptParams": params,
    }
    for attempt in range(1, max_retries + 1):
        try:
            result = auth.api_request(
                f"{BASE_URL}/api/material/creation/imageCreate",
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                method="POST",
            )
            code = result.get("code")
            msg  = result.get("msg", "")

            # Fatal: credits exhausted — stop immediately, no retry
            if code == 1007:
                raise InsufficientCreditsError(
                    f"AWB credits exhausted (code 1007): {msg}"
                )

            # Duplicate submission — task may already be queued server-side
            if code == 6003:
                print(f"  ⚠ Duplicate submission detected (code 6003): {msg}", flush=True)
                return None

            task_id = result.get("data")
            if task_id:
                print(f"  ✓ 任务已提交: {task_id}", flush=True)
                return task_id
            print(f"  ⚠ 提交返回无 data (第{attempt}/{max_retries}次): {str(result)[:200]}", flush=True)
        except InsufficientCreditsError:
            raise  # propagate immediately without retry
        except Exception as e:
            print(f"  ⚠ 提交异常 (第{attempt}/{max_retries}次): {e}", flush=True)
        if attempt < max_retries:
            # Use a fresh prompt suffix to avoid server-side dedup on retry
            payload["taskPrompt"] = prompt + " " + uuid.uuid4().hex[:6]
            time.sleep(2)
    print(f"  ❌ 提交失败，已重试 {max_retries} 次", flush=True)
    return None


def poll_image_task(task_id, timeout=600, label=""):
    """
    轮询图片任务直到完成。

    Returns:
        {"result": [url, ...], "show": [url, ...]} 或 None
    """
    start_time = time.time()
    consecutive_errors = 0
    max_errors = 10
    lbl = f"[{label}] " if label else ""

    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            print(f"  ❌ {lbl}超时（{timeout}秒）", flush=True)
            return None
        try:
            result = auth.api_request(
                f"{BASE_URL}/api/material/creation/imageCreateGet?taskId={task_id}",
                method="GET",
            )
            if result.get("code") != 200:
                consecutive_errors += 1
                print(f"  ⚠ {lbl}接口错误 ({consecutive_errors}/{max_errors}): {result.get('msg')}", flush=True)
                if consecutive_errors >= max_errors:
                    print(f"  ❌ {lbl}连续接口错误，停止轮询", flush=True)
                    return None
                time.sleep(3)
                continue

            consecutive_errors = 0
            data   = result.get("data", {})
            status = data.get("taskStatus", "UNKNOWN")

            if status == "SUCCESS":
                result_urls  = data.get("resultFileList", [])
                display_urls = data.get("resultFileDisplayList", [])
                print(f"  ✓ {lbl}生成成功，获取到 {len(result_urls)} 张图片", flush=True)
                return {"result": result_urls, "show": display_urls}
            elif status in ("FAIL", "FAILED"):
                print(f"  ❌ {lbl}生成失败: {data.get('errorMsg', '未知')}", flush=True)
                return None
            else:
                queue_num = data.get("taskQueueNum", "-")
                print(f"  ⏳ {lbl}状态: {status}, 队列: {queue_num}, 已等待: {elapsed:.0f}s", flush=True)
            time.sleep(5)
        except Exception as e:
            consecutive_errors += 1
            print(f"  ⚠ {lbl}查询异常 ({consecutive_errors}/{max_errors}): {e}", flush=True)
            if consecutive_errors >= max_errors:
                print(f"  ❌ {lbl}连续请求失败，停止轮询", flush=True)
                return None
            time.sleep(5)


def check_task_once(task_id):
    """单次查询任务状态，立即返回。

    Returns:
        {
            "status": "SUCCESS" | "FAIL" | "PROCESSING" | "QUEUE" | ...,
            "result_urls": [...],
            "display_urls": [...],
            "error_msg": "...",
            "queue_num": ...,
        }
        异常时返回 {"status": "ERROR", "error_msg": "..."}
    """
    try:
        result = auth.api_request(
            f"{BASE_URL}/api/material/creation/imageCreateGet?taskId={task_id}",
            method="GET",
        )
        if result.get("code") != 200:
            return {"status": "ERROR", "error_msg": result.get("msg", "接口错误")}
        data = result.get("data", {})
        status = data.get("taskStatus", "UNKNOWN")
        return {
            "status": status,
            "result_urls": data.get("resultFileList", []),
            "display_urls": data.get("resultFileDisplayList", []),
            "error_msg": data.get("errorMsg", ""),
            "queue_num": data.get("taskQueueNum", -1),
        }
    except Exception as e:
        return {"status": "ERROR", "error_msg": str(e)}


def download_image(url, output_path):
    """下载图片到本地，返回路径字符串或 None"""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["curl", "-s", "-L", "-o", str(output_path), url],
            check=True, timeout=60,
        )
        if output_path.exists() and output_path.stat().st_size > 1000:
            print(f"  ✓ 已下载: {output_path.name} ({output_path.stat().st_size // 1024}KB)", flush=True)
            return str(output_path)
    except Exception as e:
        print(f"  ❌ 下载失败: {e}", flush=True)
    return None
