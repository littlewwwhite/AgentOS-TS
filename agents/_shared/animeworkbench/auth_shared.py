#!/usr/bin/env python3

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.environ.get("AWB_BASE_URL", "https://animeworkbench.lingjingai.cn")
CONFIG_PATH = os.path.expanduser("~/.animeworkbench_auth.json")

__all__ = [
    "BASE_URL",
    "CONFIG_PATH",
    "load_config",
    "save_config",
    "_call_refresh_token",
    "get_token",
    "api_request",
    "get_user_info",
    "main",
]


def load_config() -> dict[str, Any]:
    if not os.path.exists(CONFIG_PATH):
        print(f"[ERROR] 未找到认证配置文件: {CONFIG_PATH}", file=sys.stderr)
        print("请先运行: python3 login.py  完成初始化登录", file=sys.stderr)
        sys.exit(1)

    with open(CONFIG_PATH, "r") as file:
        return json.load(file)


def save_config(config: dict[str, Any]) -> None:
    with open(CONFIG_PATH, "w") as file:
        json.dump(config, file, indent=2)


def _call_refresh_token(sid: str, last_token: str | None = None) -> tuple[str, int]:
    data = json.dumps({"refreshToken": sid}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if last_token:
        headers["Authorization"] = f"Bearer {last_token}"

    request = urllib.request.Request(
        f"{BASE_URL}/api/anime/user/account/refreshToken",
        data=data,
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"refreshToken 请求失败 HTTP {error.code}: {error.read().decode()}",
        ) from error
    except Exception as error:
        raise RuntimeError(f"refreshToken 请求异常: {error}") from error

    if result.get("code") != 200:
        raise RuntimeError(
            f"refreshToken 失败: {result.get('msg', result)}，会话可能已过期，请重新运行: python3 login.py",
        )

    token = result["data"]["token"]
    expires = result["data"]["expires"]
    return token, expires


def get_token(force_refresh: bool = False) -> str:
    config = load_config()
    sid = config.get("refreshToken")
    if not sid:
        print(
            "[ERROR] 配置文件中缺少 refreshToken，请重新运行: python3 login.py",
            file=sys.stderr,
        )
        sys.exit(1)

    if not force_refresh:
        cached_token = config.get("token")
        expires_at = config.get("expiresAt", 0)
        if cached_token and expires_at and (expires_at - time.time() * 1000 > 60_000):
            return cached_token

    last_token = config.get("token")
    token, expires_ms = _call_refresh_token(sid, last_token)
    config["token"] = token
    config["expiresAt"] = int(time.time() * 1000) + expires_ms
    save_config(config)
    return token


def api_request(
    url: str,
    data: bytes | None = None,
    method: str = "GET",
    extra_headers: dict[str, str] | None = None,
    token: str | None = None,
    max_retries: int = 3,
) -> dict[str, Any]:
    if token is None:
        token = get_token()

    headers = {"Authorization": f"Bearer {token}"}
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    if extra_headers:
        headers.update(extra_headers)

    def _do_request(active_token: str) -> dict[str, Any]:
        request_headers = {**headers, "Authorization": f"Bearer {active_token}"}
        request = urllib.request.Request(
            url,
            data=data,
            headers=request_headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    for attempt in range(1, max_retries + 1):
        try:
            result = _do_request(token)
            break
        except urllib.error.HTTPError:
            raise
        except Exception as error:
            if attempt < max_retries:
                print(
                    f"[WARN] 请求失败 ({attempt}/{max_retries})，{error}，重试中...",
                    file=sys.stderr,
                )
                time.sleep(2)
            else:
                raise RuntimeError(
                    f"请求失败，已重试 {max_retries} 次: {error}",
                ) from error

    if result.get("code") == 701:
        print("[INFO] Token 已过期，自动刷新中...", file=sys.stderr)
        refreshed_token = get_token(force_refresh=True)
        result = _do_request(refreshed_token)
        if result.get("code") == 701:
            raise RuntimeError("刷新 token 后仍然过期，请重新登录: python3 login.py")

    return result


def get_user_info() -> dict[str, Any]:
    config = load_config()
    token = get_token()
    parts = token.split(".")
    if len(parts) >= 2:
        padding = "=" * (4 - len(parts[1]) % 4)
        payload_b64 = parts[1].replace("-", "+").replace("_", "/") + padding
        payload = json.loads(base64.b64decode(payload_b64).decode("utf-8"))
    else:
        payload = {}

    group_id = config.get("groupId") or payload.get("groupId", "")
    return {
        "token": token,
        "userId": payload.get("sub"),
        "groupId": group_id,
        "userName": payload.get("userName"),
    }


def main() -> None:
    info = get_user_info()
    print(f"userId  : {info.get('userId')}")
    print(f"groupId : {info.get('groupId')}")
    print(f"userName: {info.get('userName')}")
    print(f"token   : {info.get('token', '')[:40]}...")
