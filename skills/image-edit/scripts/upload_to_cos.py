#!/usr/bin/env python3
"""
upload_to_cos.py — 上传本地图片到腾讯云 COS

用法：
    python3 upload_to_cos.py --file /path/to/image.jpg

Token 和 Group ID 从 ~/.animeworkbench_auth.json 自动获取；
也可手动指定 --token 和 --group-id 覆盖。
"""

import argparse
import hashlib
import hmac
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

sys.path.insert(0, os.path.dirname(__file__))
import auth as _auth


CONTENT_TYPE_MAP = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
}


def get_cos_secret(base_url: str, token: str, group_id: str) -> dict:
    url = f"{base_url}/api/anime/workbench/TencentCloud/getSecret"
    body = json.dumps({
        "sceneType": "material-image-edit",
        "groupId": group_id,
        "projectNo": ""
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def sha1_hex(data: str) -> str:
    return hashlib.sha1(data.encode()).hexdigest()


def hmac_sha1_hex(key: str, msg: str) -> str:
    return hmac.new(key.encode(), msg.encode(), hashlib.sha1).hexdigest()


def build_cos_auth(secret_id: str, secret_key: str, method: str,
                   uri_path: str, query_params: dict, headers: dict) -> str:
    """
    按腾讯云 COS q-sign-algorithm=sha1 规范生成 Authorization 头。
    """
    now = int(time.time())
    expire = now + 900  # 15 分钟有效期
    q_sign_time = f"{now};{expire}"

    # SignKey
    sign_key = hmac_sha1_hex(secret_key, q_sign_time)

    # 规范化 Header 列表（key 统一小写，value URL 编码）
    sorted_header_keys = sorted(k.lower() for k in headers)
    header_str = "&".join(
        f"{k}={urllib.parse.quote(str(headers[k]), safe='')}"
        for k in sorted(headers.keys(), key=str.lower)
    )

    # 规范化 Query 参数
    sorted_param_keys = sorted(k.lower() for k in query_params)
    param_str = "&".join(
        f"{k}={urllib.parse.quote(str(query_params[k]), safe='')}"
        for k in sorted(query_params.keys(), key=str.lower)
    )

    # HttpString
    http_string = f"{method.lower()}\n{uri_path}\n{param_str}\n{header_str}\n"

    # StringToSign
    string_to_sign = f"sha1\n{q_sign_time}\n{sha1_hex(http_string)}\n"

    # Signature
    signature = hmac_sha1_hex(sign_key, string_to_sign)

    header_list = ";".join(sorted_header_keys)
    param_list = ";".join(sorted_param_keys)

    return (
        f"q-sign-algorithm=sha1"
        f"&q-ak={secret_id}"
        f"&q-sign-time={q_sign_time}"
        f"&q-key-time={q_sign_time}"
        f"&q-header-list={header_list}"
        f"&q-url-param-list={param_list}"
        f"&q-signature={signature}"
    )


def build_presigned_url(secret_id: str, secret_key: str, session_token: str,
                        bucket: str, region: str, object_key: str,
                        expire_seconds: int = 3600) -> str:
    """生成 COS 预签名 URL（含 STS token），有效期默认 1 小时。"""
    now = int(time.time())
    q_sign_time = f"{now};{now + expire_seconds}"
    sign_key = hmac_sha1_hex(secret_key, q_sign_time)

    host = f"{bucket}.cos.{region}.myqcloud.com"
    uri_path = f"/{object_key}"

    # x-cos-security-token 必须加入签名的 query 参数列表
    signed_params = {"x-cos-security-token": session_token}
    sorted_signed_keys = sorted(k.lower() for k in signed_params)
    param_str = "&".join(
        f"{k}={urllib.parse.quote(str(signed_params[k]), safe='')}"
        for k in sorted(signed_params.keys(), key=str.lower)
    )
    url_param_list = ";".join(sorted_signed_keys)  # "x-cos-security-token"

    # host 加入签名的 header 列表
    header_str = f"host={urllib.parse.quote(host, safe='')}"

    http_string = f"get\n{uri_path}\n{param_str}\n{header_str}\n"
    string_to_sign = f"sha1\n{q_sign_time}\n{sha1_hex(http_string)}\n"
    signature = hmac_sha1_hex(sign_key, string_to_sign)

    presigned = (
        f"https://{host}{uri_path}"
        f"?q-sign-algorithm=sha1"
        f"&q-ak={secret_id}"
        f"&q-sign-time={q_sign_time}"
        f"&q-key-time={q_sign_time}"
        f"&q-header-list=host"
        f"&q-url-param-list={url_param_list}"
        f"&q-signature={signature}"
        f"&x-cos-security-token={urllib.parse.quote(session_token, safe='')}"
    )
    return presigned


def upload_file(credential: dict, file_path: str, group_id: str) -> str:
    """上传文件到 COS，返回预签名访问 URL。"""
    # 凭证可能嵌套在 credentials 子对象内
    creds = credential.get("credentials", credential)
    tmp_secret_id = creds["tmpSecretId"]
    tmp_secret_key = creds["tmpSecretKey"]
    session_token = creds["sessionToken"]
    bucket = credential.get("bucket", "huimeng-1351980869")
    region = credential.get("region", "ap-beijing")
    # path 可能带尾部斜杠，也可能不带
    cos_path = credential.get("path", f"material/image-edit/{group_id}/")
    if not cos_path.endswith("/"):
        cos_path += "/"

    filename = os.path.basename(file_path)
    timestamp_ms = int(time.time() * 1000)
    rand = random.randint(100000, 999999)
    object_key = f"{cos_path}upload-{timestamp_ms}-{rand}-{filename}"

    with open(file_path, "rb") as f:
        file_data = f.read()

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = CONTENT_TYPE_MAP.get(ext, "application/octet-stream")

    host = f"{bucket}.cos.{region}.myqcloud.com"
    cos_url = f"https://{host}/{object_key}"
    uri_path = f"/{object_key}"

    headers_to_sign = {
        "content-type": content_type,
        "host": host,
        "x-cos-acl": "public-read",
        "x-cos-security-token": session_token,
    }

    auth = build_cos_auth(
        tmp_secret_id, tmp_secret_key,
        "PUT", uri_path,
        {}, headers_to_sign
    )

    req = urllib.request.Request(cos_url, data=file_data, method="PUT")
    req.add_header("Content-Type", content_type)
    req.add_header("Host", host)
    req.add_header("Authorization", auth)
    req.add_header("x-cos-acl", "public-read")
    req.add_header("x-cos-security-token", session_token)

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        raise Exception(f"COS 上传失败，HTTP {e.code}: {e.reason}")

    if status not in (200, 204):
        raise Exception(f"COS 上传失败，HTTP 状态码: {status}")

    # 上传时已设置 public-read，直接返回 plain URL
    return cos_url


def main():
    parser = argparse.ArgumentParser(description="上传本地图片到腾讯云 COS")
    parser.add_argument("--base-url", default="https://animeworkbench-pre.lingjingai.cn",
                        help="API Base URL")
    parser.add_argument("--token", default=None, help="Bearer Token（可选，默认从配置文件自动获取）")
    parser.add_argument("--credentials-json", default=None,
                        help="预先获取的 COS 临时凭证 JSON 字符串（来自 getSecret 接口的 data 字段），提供后无需 --token")
    parser.add_argument("--group-id", default=None, help="用户 Group ID（可选，默认从配置文件自动解析）")
    parser.add_argument("--file", required=True, help="本地文件路径")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"[ERROR] 文件不存在: {args.file}", file=sys.stderr)
        sys.exit(1)

    # 自动从 auth 模块获取 token 和 group_id
    if not args.token and not args.credentials_json:
        user_info = _auth.get_user_info()
        token = user_info["token"]
        group_id = args.group_id or user_info.get("groupId")
    else:
        token = args.token or _auth.get_token()
        group_id = args.group_id or _auth.get_user_info().get("groupId")

    if not group_id:
        print("[ERROR] 无法获取 groupId，请手动传入 --group-id", file=sys.stderr)
        sys.exit(1)

    if args.credentials_json:
        try:
            credential = json.loads(args.credentials_json)
        except json.JSONDecodeError as e:
            print(f"[ERROR] --credentials-json 不是合法的 JSON: {e}", file=sys.stderr)
            sys.exit(1)
        print(f"使用预取凭证，正在上传文件: {args.file}")
    else:
        print(f"正在获取 COS 临时凭证...")
        try:
            resp = get_cos_secret(args.base_url, token, group_id)
        except Exception as e:
            print(f"[ERROR] 请求凭证失败: {e}", file=sys.stderr)
            sys.exit(1)

        if resp.get("code") != 200:
            print(f"[ERROR] 获取 COS 凭证失败: {resp.get('msg')}", file=sys.stderr)
            sys.exit(1)

        credential = resp.get("data", {})
        print(f"凭证获取成功，正在上传文件: {args.file}")

    try:
        cos_url = upload_file(credential, args.file, group_id)
    except Exception as e:
        print(f"[ERROR] 上传失败: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"\n上传成功！")
    print(f"图片 URL: {cos_url}")
    sys.exit(0)


if __name__ == "__main__":
    main()
