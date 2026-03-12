#!/usr/bin/env python3

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

from auth_shared import CONFIG_PATH, _call_refresh_token

BASE_URL = os.environ.get("AWB_BASE_URL", "https://animeworkbench.lingjingai.cn")

__all__ = [
    "BASE_URL",
    "phone_login",
    "update_current_group",
    "save_config",
    "main",
]


def phone_login(phone: str, code: str) -> dict[str, Any]:
    data = json.dumps({"phone": phone, "code": code}).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}/api/anime/user/account/phoneLogin",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print(
            f"[ERROR] 登录失败 HTTP {error.code}: {error.read().decode()}",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as error:
        print(f"[ERROR] 登录异常: {error}", file=sys.stderr)
        sys.exit(1)

    if result.get("code") != 200:
        print(f"[ERROR] 登录失败: {result.get('msg', result)}", file=sys.stderr)
        sys.exit(1)

    return result["data"]


def _role_label(group_member: dict[str, Any]) -> str:
    if group_member.get("relationType") == 0:
        return "创建者"
    return "导演" if group_member.get("character") == 1 else "成员"


def _decode_jwt_groupid(token: str) -> str:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return ""
        padding = "=" * (4 - len(parts[1]) % 4)
        payload = json.loads(
            base64.b64decode(
                parts[1].replace("-", "+").replace("_", "/") + padding,
            ).decode("utf-8"),
        )
        return payload.get("groupId", "")
    except Exception:
        return ""


def update_current_group(token: str, group_id: str) -> dict[str, Any] | None:
    data = json.dumps({"groupId": group_id}).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}/api/anime/user/group/updateCurrentGroup",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print(
            f"[WARN] 切换团队请求失败 HTTP {error.code}: {error.read().decode()}",
            file=sys.stderr,
        )
        return None
    except Exception as error:
        print(f"[WARN] 切换团队请求异常: {error}", file=sys.stderr)
        return None

    if result.get("code") != 200:
        print(f"[WARN] 切换团队失败: {result.get('msg', result)}", file=sys.stderr)
        return None

    print("已通知服务端切换当前团队")
    return result.get("data")


def _save_updated_token(token_data: dict[str, Any] | None) -> None:
    if not token_data or not token_data.get("token") or not os.path.exists(CONFIG_PATH):
        return

    with open(CONFIG_PATH, "r") as file:
        config = json.load(file)

    config["token"] = token_data["token"]
    config["expiresAt"] = int(time.time() * 1000) + token_data.get("expires", 0)
    with open(CONFIG_PATH, "w") as file:
        json.dump(config, file, indent=2)
    os.chmod(CONFIG_PATH, 0o600)


def save_config(sid: str, group_id: str, initial_token: str | None = None) -> None:
    config = {"refreshToken": sid, "groupId": group_id}
    if initial_token:
        config["token"] = initial_token

    with open(CONFIG_PATH, "w") as file:
        json.dump(config, file, indent=2)
    os.chmod(CONFIG_PATH, 0o600)
    print(f"配置已保存至: {CONFIG_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="手机号验证码登录，选择团队，保存会话到本地配置文件",
    )
    parser.add_argument(
        "--refresh-token",
        help="直接提供已有的 refreshToken (SID)，跳过手机登录",
    )
    parser.add_argument("--group-id", help="直接指定团队 groupId，跳过团队选择交互")
    parser.add_argument("--phone", help="手机号")
    parser.add_argument("--code", help="验证码（需配合 --phone 使用）")
    parser.add_argument(
        "--select-group",
        metavar="GROUP_ID",
        help="更新已有配置中的团队 groupId（多团队登录的第二步）",
    )
    args = parser.parse_args()

    if args.select_group:
        if not os.path.exists(CONFIG_PATH):
            print("[ERROR] 未找到配置文件，请先完成登录", file=sys.stderr)
            sys.exit(1)
        with open(CONFIG_PATH, "r") as file:
            config = json.load(file)
        config["groupId"] = args.select_group
        with open(CONFIG_PATH, "w") as file:
            json.dump(config, file, indent=2)
        os.chmod(CONFIG_PATH, 0o600)
        token = config.get("token", "")
        if token:
            response_data = update_current_group(token, args.select_group)
            _save_updated_token(response_data)
        print(f"团队已更新，groupId: {args.select_group}")
        return

    if args.refresh_token:
        group_id = args.group_id or ""
        if not group_id:
            try:
                token, _ = _call_refresh_token(args.refresh_token)
                group_id = _decode_jwt_groupid(token)
                save_config(args.refresh_token, group_id, initial_token=token)
            except Exception:
                save_config(args.refresh_token, group_id="")
        else:
            save_config(args.refresh_token, group_id)
        print(
            f"refreshToken 已保存，团队 groupId: {group_id or '（未知，建议重新运行选择团队）'}",
        )
        return

    if not args.phone:
        print("[ERROR] 请通过 --phone 提供手机号", file=sys.stderr)
        sys.exit(1)
    if not args.code:
        print("[ERROR] 请通过 --code 提供验证码", file=sys.stderr)
        sys.exit(1)

    print("正在登录...")
    data = phone_login(args.phone, args.code)

    sid = data.get("session")
    if not sid:
        print("[ERROR] 登录成功但未获取到 session 字段", file=sys.stderr)
        sys.exit(1)

    group_members = data.get("groupMembers") or []

    if args.group_id:
        group_id = args.group_id
        selected_name = next(
            (
                group_member["groupName"]
                for group_member in group_members
                if group_member["groupId"] == group_id
            ),
            group_id,
        )
        initial_token = data.get("token")
        save_config(sid, group_id, initial_token=initial_token)
        if initial_token:
            response_data = update_current_group(initial_token, group_id)
            _save_updated_token(response_data)
        print(f"\n登录成功！当前团队：{selected_name}")
        print("后续调用将自动刷新 JWT Token。")
        return

    if not group_members:
        group_id = _decode_jwt_groupid(data.get("token", ""))
        save_config(sid, group_id, initial_token=data.get("token"))
        print("\n登录成功！（未获取到团队列表，已使用 JWT 默认 groupId）")
        print("后续调用将自动刷新 JWT Token。")
        return

    if len(group_members) == 1:
        selected = group_members[0]
        group_id = selected["groupId"]
        initial_token = data.get("token")
        save_config(sid, group_id, initial_token=initial_token)
        if initial_token:
            response_data = update_current_group(initial_token, group_id)
            _save_updated_token(response_data)
        print(f"\n登录成功！当前团队：{selected['groupName']}  [{_role_label(selected)}]")
        print("后续调用将自动刷新 JWT Token。")
        return

    save_config(sid, group_id="", initial_token=data.get("token"))
    teams_info = [
        {
            "index": index + 1,
            "groupId": group_member["groupId"],
            "groupName": group_member["groupName"],
            "role": _role_label(group_member),
        }
        for index, group_member in enumerate(group_members)
    ]
    print(f"TEAMS_JSON:{json.dumps(teams_info, ensure_ascii=False)}")
    sys.exit(2)


if __name__ == "__main__":
    main()
