#!/usr/bin/env python3
"""
认证工具模块 - 通过 refreshToken 接口获取有效 JWT

配置文件: ~/.animeworkbench_auth.json
  - refreshToken: 长效会话 ID（SID），通过 login.py 获取
  - groupId:      用户选择的工作团队 ID（通过 login.py 选择）
  - token:        缓存的 JWT（自动管理）
  - expiresAt:    JWT 过期时间戳（毫秒，自动管理）

用法（独立运行）:
  python3 auth.py          # 打印当前用户信息和 token
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = "https://animeworkbench-pre.lingjingai.cn"
CONFIG_PATH = os.path.expanduser("~/.animeworkbench_auth.json")


def load_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        print(f"[ERROR] 未找到认证配置文件: {CONFIG_PATH}", file=sys.stderr)
        print("请先运行: python3 login.py  完成初始化登录", file=sys.stderr)
        sys.exit(1)
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)


def save_config(config: dict) -> None:
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def _call_refresh_token(sid: str, last_token: str = None) -> tuple:
    """调用 refreshToken 接口（网关白名单，无需 Authorization），返回 (token, expires_ms)。
    若 session.currentGroupId 未初始化，需附带上一次的 JWT（即便过期也可用于解析 groupId）。
    """
    data = json.dumps({"refreshToken": sid}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if last_token:
        headers["Authorization"] = f"Bearer {last_token}"
    req = urllib.request.Request(
        f"{BASE_URL}/api/anime/user/account/refreshToken",
        data=data,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"refreshToken 请求失败 HTTP {e.code}: {e.read().decode()}") from e
    except Exception as e:
        raise RuntimeError(f"refreshToken 请求异常: {e}") from e

    if result.get("code") != 200:
        raise RuntimeError(f"refreshToken 失败: {result.get('msg', result)}，会话可能已过期，请重新运行: python3 login.py")

    token = result["data"]["token"]
    expires = result["data"]["expires"]  # 毫秒
    return token, expires


def get_token(force_refresh: bool = False) -> str:
    """获取有效 JWT Token，必要时自动调用 refreshToken 接口刷新。

    Args:
        force_refresh: 若为 True，忽略缓存强制刷新 token。
    """
    config = load_config()
    sid = config.get("refreshToken")
    if not sid:
        print("[ERROR] 配置文件中缺少 refreshToken，请重新运行: python3 login.py", file=sys.stderr)
        sys.exit(1)

    if not force_refresh:
        # 若缓存的 token 仍有效（剩余 > 60 秒），直接返回
        cached_token = config.get("token")
        expires_at = config.get("expiresAt", 0)
        if cached_token and expires_at and (expires_at - time.time() * 1000 > 60_000):
            return cached_token

    # 调用 refreshToken 接口获取新 JWT（附带上一次 token 用于 groupId 解析）
    last_token = config.get("token")
    token, expires_ms = _call_refresh_token(sid, last_token)
    config["token"] = token
    config["expiresAt"] = int(time.time() * 1000) + expires_ms
    save_config(config)
    return token


def api_request(url: str, data: bytes = None, method: str = "GET",
                extra_headers: dict = None, token: str = None,
                max_retries: int = 3) -> dict:
    """发起 API 请求，遇到 token 过期（code 701）时自动刷新并重试一次。
    遇到网络瞬时错误（如 SSL EOF）时自动重试最多 max_retries 次。

    Returns:
        解析后的 JSON 响应字典。
    """
    if token is None:
        token = get_token()

    headers = {"Authorization": f"Bearer {token}"}
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    if extra_headers:
        headers.update(extra_headers)

    def _do_request(tk: str) -> dict:
        hdrs = {**headers, "Authorization": f"Bearer {tk}"}
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            result = _do_request(token)
            break
        except urllib.error.HTTPError:
            raise  # HTTP 错误（4xx/5xx）直接抛出，不重试
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                print(f"[WARN] 请求失败 ({attempt}/{max_retries})，{e}，重试中...", file=sys.stderr)
                time.sleep(2)
            else:
                raise RuntimeError(f"请求失败，已重试 {max_retries} 次: {e}") from e

    # 701 = 登录状态已过期 → 强制刷新 token 并重试一次
    if result.get("code") == 701:
        print("[INFO] Token 已过期，自动刷新中...", file=sys.stderr)
        new_token = get_token(force_refresh=True)
        result = _do_request(new_token)
        if result.get("code") == 701:
            raise RuntimeError("刷新 token 后仍然过期，请重新登录: python3 login.py")

    return result


def get_user_info() -> dict:
    """获取有效 token 并返回用户信息。
    groupId 优先使用配置文件中用户选定的团队，其次从 JWT payload 解析。
    """
    config = load_config()
    token = get_token()

    # 从 JWT payload 解析 userId / userName（不验证签名）
    parts = token.split(".")
    if len(parts) >= 2:
        padding = "=" * (4 - len(parts[1]) % 4)
        payload_b64 = parts[1].replace("-", "+").replace("_", "/") + padding
        payload = json.loads(base64.b64decode(payload_b64).decode("utf-8"))
    else:
        payload = {}

    # groupId：优先使用配置文件中存储的用户选定团队
    group_id = config.get("groupId") or payload.get("groupId", "")

    return {
        "token": token,
        "userId": payload.get("sub"),
        "groupId": group_id,
        "userName": payload.get("userName"),
    }


if __name__ == "__main__":
    info = get_user_info()
    print(f"userId  : {info.get('userId')}")
    print(f"groupId : {info.get('groupId')}")
    print(f"userName: {info.get('userName')}")
    print(f"token   : {info.get('token', '')[:40]}...")
