#!/usr/bin/env python3
"""
提交视频生成任务（battle 模式默认关闭）

用法:
  python3 submit_video_create.py \
    --model-code MODEL_CODE \
    [--handle-code HANDLE_CODE] \
    --prompt "提示词" \
    --prompt-params '{"key":"value"}'

Token 从 ~/.animeworkbench_auth.json 自动获取（通过 auth.py）；
若需手动指定，可传 --token TOKEN。
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import auth as _auth


def main():
    parser = argparse.ArgumentParser(description="提交视频生成任务")
    parser.add_argument("--base-url", default="https://animeworkbench.lingjingai.cn",
                        help="API Base URL")
    parser.add_argument("--token", default=None, help="Bearer Token（可选，默认从配置文件自动获取）")
    parser.add_argument("--model-code", required=True, help="模型编码")
    parser.add_argument("--handle-code", default="", help="处理器编码（若模型有多个 handler 则必填）")
    parser.add_argument("--prompt", default="", help="任务提示词")
    parser.add_argument("--prompt-params", default="{}", help="提示词参数 JSON 字符串")
    args = parser.parse_args()

    try:
        prompt_params = json.loads(args.prompt_params)
    except json.JSONDecodeError as e:
        print(f"[ERROR] --prompt-params 不是合法的 JSON: {e}", file=sys.stderr)
        sys.exit(1)

    body = {
        "modelCode": args.model_code,
        "taskPrompt": args.prompt,
        "promptParams": prompt_params,
        "bizScenarioParams": {"enableBattle": False},
    }
    if args.handle_code:
        body["handleCode"] = args.handle_code

    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    url = f"{args.base_url}/api/material/creation/videoCreate"
    result = _auth.api_request(url, data=data, method="POST", token=args.token)

    print(json.dumps(result, ensure_ascii=False, indent=2))

    task_id = result.get("data")
    if task_id:
        print(f"\ntaskId: {task_id}")
    else:
        print(f"\n[WARN] 未获取到 taskId，响应: {result}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
