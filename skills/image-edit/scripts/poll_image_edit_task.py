#!/usr/bin/env python3
"""
poll_image_edit_task.py — 轮询图片编辑任务状态，直至完成或超时

用法：
    python3 poll_image_edit_task.py --task-id <taskId> \
        [--custom-task-type <customTaskType>] \
        [--interval 3] [--timeout 300]

Token 从 ~/.animeworkbench_auth.json 自动获取（通过 auth.py）；
若需手动指定，可传 --token TOKEN。
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Optional

sys.path.insert(0, os.path.dirname(__file__))
import auth as _auth


TERMINAL_STATUSES = {"SUCCESS", "FAIL", "FAILED"}


def query_task(base_url: str, task_id: str, custom_task_type: Optional[str]) -> dict:
    url = f"{base_url}/api/material/creation/imageEditGet?taskId={task_id}"
    if custom_task_type:
        url += f"&customTaskType={custom_task_type}"
    return _auth.api_request(url, method="GET")


MAX_CONSECUTIVE_ERRORS = 10


def poll(base_url: str, task_id: str, custom_task_type: Optional[str],
         interval: int, timeout: int) -> int:
    start = time.time()
    attempt = 0
    consecutive_errors = 0
    while True:
        attempt += 1
        elapsed = time.time() - start
        if elapsed > timeout:
            print(f"\n[TIMEOUT] 已超过 {timeout} 秒，任务仍未完成。", file=sys.stderr)
            return 1

        try:
            resp = query_task(base_url, task_id, custom_task_type)
        except BaseException as e:
            consecutive_errors += 1
            print(f"[{attempt:>3}] [WARN] 请求异常 ({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {e}",
                  file=sys.stderr)
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                print(f"\n[ERROR] 连续 {MAX_CONSECUTIVE_ERRORS} 次请求失败，停止轮询。", file=sys.stderr)
                return 1
            time.sleep(interval)
            continue

        if resp.get("code") != 200:
            consecutive_errors += 1
            print(f"[{attempt:>3}] [WARN] 接口返回错误 ({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {resp.get('msg')}",
                  file=sys.stderr)
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                print(f"\n[ERROR] 连续 {MAX_CONSECUTIVE_ERRORS} 次接口错误，停止轮询。", file=sys.stderr)
                return 1
            time.sleep(interval)
            continue

        # 请求成功，重置连续错误计数
        consecutive_errors = 0

        data = resp.get("data", {})
        status = data.get("taskStatus", "UNKNOWN")
        queue_num = data.get("taskQueueNum") or "-"

        print(f"[{attempt:>3}] 状态: {status:<12} 队列: {queue_num:<5} 耗时: {elapsed:.1f}s")

        if status in TERMINAL_STATUSES:
            print()
            if status == "SUCCESS":
                print("编辑成功！")
                files = data.get("resultFileList") or []
                display_files = data.get("resultFileDisplayList") or []
                if files:
                    print("\n结果文件：")
                    for f in files:
                        print(f"  {f}")
                if display_files:
                    print("\n展示文件：")
                    for f in display_files:
                        print(f"  {f}")
                return 0
            else:
                print(f"编辑失败！错误信息：{data.get('errorMsg', '未知错误')}", file=sys.stderr)
                return 1

        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="轮询图片编辑任务状态")
    parser.add_argument("--base-url", default="https://animeworkbench-pre.lingjingai.cn",
                        help="API Base URL")
    parser.add_argument("--task-id", required=True, help="任务ID")
    parser.add_argument("--token", default=None, help="Bearer Token（可选，默认从配置文件自动获取）")
    parser.add_argument("--custom-task-type", default=None, help="自定义任务类型（可选）")
    parser.add_argument("--interval", type=int, default=3, help="轮询间隔（秒），默认 3")
    parser.add_argument("--timeout", type=int, default=300, help="超时时间（秒），默认 300")
    args = parser.parse_args()

    print(f"开始轮询图片编辑任务: {args.task_id}")
    print(f"轮询间隔: {args.interval}s  超时: {args.timeout}s")
    print("-" * 50)

    sys.exit(poll(args.base_url, args.task_id, args.custom_task_type,
                  args.interval, args.timeout))


if __name__ == "__main__":
    main()
