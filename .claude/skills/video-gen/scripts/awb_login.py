#!/usr/bin/env python3
"""
初始化登录 - 手机号验证码登录，选择工作团队，保存会话到本地配置文件。

用法:
  python3 login.py --phone 13800138000 --code 123456
      # 登录（单团队自动保存；多团队输出 TEAMS_JSON: 并退出码 2）

  python3 login.py --phone 13800138000 --code 123456 --group-id <groupId>
      # 登录并直接指定团队，非交互完成全流程

  python3 login.py --select-group <groupId>
      # 更新已有配置中的团队 groupId（多团队场景的第二步）

  python3 login.py --refresh-token <SID> [--group-id <groupId>]
      # 直接保存已有 refreshToken，跳过手机登录

  python3 login.py --base-url https://animeworkbench.lingjingai.cn --phone ...
      # 使用指定的 Base URL

验证码需由用户在浏览器自行获取。

配置文件保存至: ~/.animeworkbench_auth.json
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://animeworkbench.lingjingai.cn"
CONFIG_PATH = os.path.expanduser("~/.animeworkbench_auth.json")

# 运行时 BASE_URL
_base_url = DEFAULT_BASE_URL


def phone_login(phone: str, code: str) -> dict:
    data = json.dumps({"phone": phone, "code": code}).encode("utf-8")
    req = urllib.request.Request(
        f"{_base_url}/api/anime/user/account/phoneLogin",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[ERROR] 登录失败 HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] 登录异常: {e}", file=sys.stderr)
        sys.exit(1)
    if result.get("code") != 200:
        print(f"[ERROR] 登录失败: {result.get('msg', result)}", file=sys.stderr)
        sys.exit(1)
    return result["data"]


def _role_label(gm: dict) -> str:
    if gm.get("relationType") == 0:
        return "创建者"
    return "导演" if gm.get("character") == 1 else "成员"


def _decode_jwt_groupid(token: str) -> str:
    """从 JWT payload 解析 groupId（不验证签名）。"""
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return ""
        padding = "=" * (4 - len(parts[1]) % 4)
        payload = json.loads(base64.b64decode(
            parts[1].replace("-", "+").replace("_", "/") + padding
        ).decode("utf-8"))
        return payload.get("groupId", "")
    except Exception:
        return ""


def update_current_group(token: str, group_id: str):
    """调用 updateCurrentGroup 接口通知服务端切换当前团队，返回新 token 信息。"""
    data = json.dumps({"groupId": group_id}).encode("utf-8")
    req = urllib.request.Request(
        f"{_base_url}/api/anime/user/group/updateCurrentGroup",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[WARN] 切换团队请求失败 HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[WARN] 切换团队请求异常: {e}", file=sys.stderr)
        return None
    if result.get("code") != 200:
        print(f"[WARN] 切换团队失败: {result.get('msg', result)}", file=sys.stderr)
        return None
    print("已通知服务端切换当前团队")
    return result.get("data")


def _save_updated_token(token_data) -> None:
    """将 updateCurrentGroup 返回的新 token 写入配置文件。"""
    if not token_data or not token_data.get("token"):
        return
    if not os.path.exists(CONFIG_PATH):
        return
    with open(CONFIG_PATH, "r") as f:
        config = json.load(f)
    config["token"] = token_data["token"]
    config["expiresAt"] = int(time.time() * 1000) + token_data.get("expires", 0)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    os.chmod(CONFIG_PATH, 0o600)


def save_config(sid: str, group_id: str, initial_token: str = None) -> None:
    config = {"refreshToken": sid, "groupId": group_id}
    if initial_token:
        config["token"] = initial_token
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    os.chmod(CONFIG_PATH, 0o600)
    print(f"配置已保存至: {CONFIG_PATH}")


def main():
    global _base_url

    parser = argparse.ArgumentParser(description="手机号验证码登录，选择团队，保存会话到本地配置文件")
    parser.add_argument("--base-url", default=None,
                        help="API Base URL")
    parser.add_argument("--refresh-token", help="直接提供已有的 refreshToken (SID)，跳过手机登录")
    parser.add_argument("--group-id", help="直接指定团队 groupId，跳过团队选择交互")
    parser.add_argument("--phone", default=os.environ.get("AWB_PHONE"),
                        help="手机号 (default: $AWB_PHONE)")
    parser.add_argument("--code", default=os.environ.get("AWB_CODE"),
                        help="验证码 (default: $AWB_CODE)")
    parser.add_argument("--select-group", metavar="GROUP_ID",
                        help="更新已有配置中的团队 groupId（多团队登录的第二步）")
    args = parser.parse_args()

    # 设置 BASE_URL：命令行参数 > 环境变量 > 默认值
    if args.base_url:
        _base_url = args.base_url
    elif os.environ.get("AWB_BASE_URL"):
        _base_url = os.environ["AWB_BASE_URL"]

    # ── 模式0：更新已有配置的团队选择 ────────────────────────────
    if args.select_group:
        if not os.path.exists(CONFIG_PATH):
            print("[ERROR] 未找到配置文件，请先完成登录", file=sys.stderr)
            sys.exit(1)
        with open(CONFIG_PATH, "r") as f:
            config = json.load(f)
        config["groupId"] = args.select_group
        with open(CONFIG_PATH, "w") as f:
            json.dump(config, f, indent=2)
        os.chmod(CONFIG_PATH, 0o600)
        # 调用 updateCurrentGroup 通知服务端切换团队
        token = config.get("token", "")
        if token:
            resp_data = update_current_group(token, args.select_group)
            _save_updated_token(resp_data)
        print(f"团队已更新，groupId: {args.select_group}")
        return

    # ── 模式1：直接提供 refreshToken ──────────────────────────────
    if args.refresh_token:
        group_id = args.group_id or ""
        if not group_id:
            try:
                # 设置 auth 模块的 base_url 以保持一致
                sys.path.insert(0, os.path.dirname(__file__))
                from auth import _call_refresh_token, set_base_url as _set_base_url
                _set_base_url(_base_url)
                token, _ = _call_refresh_token(args.refresh_token)
                group_id = _decode_jwt_groupid(token)
                save_config(args.refresh_token, group_id, initial_token=token)
            except Exception:
                save_config(args.refresh_token, group_id="")
        else:
            save_config(args.refresh_token, group_id)
        print(f"refreshToken 已保存，团队 groupId: {group_id or '（未知，建议重新运行选择团队）'}")
        return

    # ── 模式2：手机号+验证码登录 ──────────────────────────────────
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

    # 若明确指定了 --group-id，直接使用
    if args.group_id:
        group_id = args.group_id
        selected_name = next(
            (gm["groupName"] for gm in group_members if gm["groupId"] == group_id),
            group_id,
        )
        initial_token = data.get("token")
        save_config(sid, group_id, initial_token=initial_token)
        # 调用 updateCurrentGroup 通知服务端切换团队
        if initial_token:
            resp_data = update_current_group(initial_token, group_id)
            _save_updated_token(resp_data)
        print(f"\n登录成功！当前团队：{selected_name}")
        print("后续调用将自动刷新 JWT Token。")
        return

    # 无团队信息
    if not group_members:
        group_id = _decode_jwt_groupid(data.get("token", ""))
        save_config(sid, group_id, initial_token=data.get("token"))
        print("\n登录成功！（未获取到团队列表，已使用 JWT 默认 groupId）")
        print("后续调用将自动刷新 JWT Token。")
        return

    # 单团队：自动保存
    if len(group_members) == 1:
        selected = group_members[0]
        group_id = selected["groupId"]
        initial_token = data.get("token")
        save_config(sid, group_id, initial_token=initial_token)
        # 调用 updateCurrentGroup 通知服务端切换团队
        if initial_token:
            resp_data = update_current_group(initial_token, group_id)
            _save_updated_token(resp_data)
        print(f"\n登录成功！当前团队：{selected['groupName']}  [{_role_label(selected)}]")
        print("后续调用将自动刷新 JWT Token。")
        return

    # Multiple groups: check AWB_DEFAULT_GROUP env var for auto-selection
    default_group = os.environ.get("AWB_DEFAULT_GROUP", "")
    if default_group:
        match = next((gm for gm in group_members if gm["groupId"] == default_group), None)
        if match:
            initial_token = data.get("token")
            save_config(sid, default_group, initial_token=initial_token)
            if initial_token:
                resp_data = update_current_group(initial_token, default_group)
                _save_updated_token(resp_data)
            print(f"\n登录成功！当前团队（AWB_DEFAULT_GROUP）：{match['groupName']}  [{_role_label(match)}]")
            print("后续调用将自动刷新 JWT Token。")
            return

    # 多个团队且无默认：保存会话（groupId 留空），输出团队 JSON，退出码 2
    save_config(sid, group_id="", initial_token=data.get("token"))
    teams_info = [
        {
            "index": i + 1,
            "groupId": gm["groupId"],
            "groupName": gm["groupName"],
            "role": _role_label(gm),
        }
        for i, gm in enumerate(group_members)
    ]
    print(f"TEAMS_JSON:{json.dumps(teams_info, ensure_ascii=False)}")
    sys.exit(2)


if __name__ == "__main__":
    main()