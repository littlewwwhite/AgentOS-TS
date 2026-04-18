#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
video_api.py — AnimeWorkbench 视频生成 API 客户端（自包含）

整合了认证、提交任务、轮询状态、下载视频的完整逻辑，
无需依赖外部 video-create skill。

认证配置文件: ~/.animeworkbench_auth.json
  - refreshToken: 长效会话 ID（SID）
  - groupId:      用户选择的工作团队 ID
  - token:        缓存的 JWT（自动管理）
  - expiresAt:    JWT 过期时间戳（毫秒，自动管理）
"""

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
import uuid
from typing import Dict, List, Optional

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

from config_loader import get_video_model_config, get_generation_config

_vm_cfg = get_video_model_config()
_gen_cfg = get_generation_config()

BASE_URL = _vm_cfg.get("api_base_url", "https://animeworkbench.lingjingai.cn")
CONFIG_PATH = os.path.expanduser("~/.animeworkbench_auth.json")

TERMINAL_STATUSES = {"SUCCESS", "FAIL", "FAILED"}
MAX_CONSECUTIVE_ERRORS = _gen_cfg.get("max_consecutive_errors", 10)


# ============================================================
# 认证模块（来源: video-create/scripts/auth.py）
# ============================================================

def _load_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        raise RuntimeError(
            f"未找到认证配置文件: {CONFIG_PATH}\n"
            "请先运行 login.py 完成初始化登录"
        )
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)


def _save_config(config: dict) -> None:
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def _call_refresh_token(sid: str, last_token: str = None) -> tuple:
    """调用 refreshToken 接口，返回 (token, expires_ms)。"""
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
        raise RuntimeError(
            f"refreshToken 失败: {result.get('msg', result)}，"
            "会话可能已过期，请重新运行 login.py"
        )

    token = result["data"]["token"]
    expires = result["data"]["expires"]  # 毫秒
    return token, expires


def get_token(force_refresh: bool = False) -> str:
    """获取有效 JWT Token，必要时自动刷新。"""
    config = _load_config()
    sid = config.get("refreshToken")
    if not sid:
        raise RuntimeError("配置文件中缺少 refreshToken，请重新运行 login.py")

    if not force_refresh:
        cached_token = config.get("token")
        expires_at = config.get("expiresAt", 0)
        if cached_token and expires_at and (expires_at - time.time() * 1000 > 60_000):
            return cached_token

    last_token = config.get("token")
    token, expires_ms = _call_refresh_token(sid, last_token)
    config["token"] = token
    config["expiresAt"] = int(time.time() * 1000) + expires_ms
    _save_config(config)
    return token


def api_request(url: str, data: bytes = None, method: str = "GET",
                extra_headers: dict = None, token: str = None,
                max_retries: int = 3) -> dict:
    """发起 API 请求，遇到 token 过期（code 701）时自动刷新并重试。
    遇到网络瞬时错误时自动重试最多 max_retries 次。
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

    for attempt in range(1, max_retries + 1):
        try:
            result = _do_request(token)
            break
        except urllib.error.HTTPError:
            raise
        except Exception as e:
            if attempt < max_retries:
                print(f"[WARN] 请求失败 ({attempt}/{max_retries})，{e}，重试中...", file=sys.stderr)
                time.sleep(2)
            else:
                raise RuntimeError(f"请求失败，已重试 {max_retries} 次: {e}") from e

    # 701 = 登录状态已过期
    if result.get("code") == 701:
        print("[INFO] Token 已过期，自动刷新中...", file=sys.stderr)
        new_token = get_token(force_refresh=True)
        result = _do_request(new_token)
        if result.get("code") == 701:
            raise RuntimeError("刷新 token 后仍然过期，请重新登录（运行 login.py）")

    return result


# ============================================================
# 模型元数据查询（modelGroupCode 等）
# ============================================================

_model_group_cache: Dict[str, str] = {}


def fetch_model_group_code(model_code: str) -> str:
    """Query modelGroupCode from model list API.

    Args:
        model_code: Model code (e.g. "KeLing3_VideoCreate_tencent")

    Returns:
        modelGroupCode string, or "" if not found
    """
    if model_code in _model_group_cache:
        return _model_group_cache[model_code]

    try:
        url = f"{BASE_URL}/api/resource/model/list/usage/VIDEO_CREATE"
        resp = api_request(url, data=b'{}', method="POST")
        for m in resp.get("data", []):
            code = m.get("modelCode", "")
            group = m.get("modelGroupCode", "")
            if group:
                _model_group_cache[code] = group
        return _model_group_cache.get(model_code, "")
    except Exception as e:
        print(f"[WARN] 获取 modelGroupCode 失败: {e}")
        return ""


# ============================================================
# ============================================================
# 视频生成模型配置表（从 config.json 加载）
# 切换模型只需修改 config.json 中 video_model.active_model
# ============================================================

VIDEO_MODEL_CONFIG = {}
for _name, _mcfg in _vm_cfg.get("models", {}).items():
    VIDEO_MODEL_CONFIG[_name] = {
        "model_code": _mcfg["model_code"],
        "model_group_code": _mcfg.get("model_group_code", ""),
        "subject_reference": _mcfg.get("subject_reference", False),
    }

ACTIVE_VIDEO_MODEL = _vm_cfg.get("active_model", "kling_omni")

DEFAULT_MODEL_CODE = VIDEO_MODEL_CONFIG[ACTIVE_VIDEO_MODEL]["model_code"]
DEFAULT_MODEL_GROUP_CODE = VIDEO_MODEL_CONFIG[ACTIVE_VIDEO_MODEL]["model_group_code"]
DEFAULT_SUBJECT_REFERENCE = VIDEO_MODEL_CONFIG[ACTIVE_VIDEO_MODEL]["subject_reference"]


def get_subject_reference_for_model(model_code: str) -> bool:
    """Return whether model_code uses subject reference mode (主体参考).

    Looks up VIDEO_MODEL_CONFIG by model_code; falls back to DEFAULT_SUBJECT_REFERENCE
    if the model is not found.
    """
    for cfg in VIDEO_MODEL_CONFIG.values():
        if cfg["model_code"] == model_code:
            return cfg["subject_reference"]
    return DEFAULT_SUBJECT_REFERENCE


# ============================================================
# 可灵3.0 Omni 主体参考模式参数构建


def build_subject_prompt_params(
    prompt: str,
    subjects: List[Dict],
    duration: str = "6",
    quality: str = "720",
    audio: bool = True,
    ratio: str = "16:9",
    need_audio: bool = True,
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
) -> tuple:
    """构建可灵3.0 Omni 主体参考模式的 promptParams 和 taskPrompt。

    Args:
        prompt: 用户提示词，主体引用处用 {subject_name} 或 【subject_name】 占位。
                例如: "{萧禾} 站在演武场中央，单手举起石锁"
                或: "【萧禾】站在演武场中央，单手举起石锁"
                【xxx（状态描述）】 会自动转换为 {xxx}（去掉括号内状态描述）。
                如果没有 {} 占位符，所有主体会自动插入到提示词开头。
        subjects: 主体列表，每项包含:
            - element_id: str — create-subject 返回的 externalId
            - name: str — 主体显示名称（如 "萧禾"）
            - desc: str — 主体描述（可选）
        duration: 视频时长秒数（字符串），如 "6" 或 "10"
        quality: 视频质量，如 "720"
        audio: 是否生成音频
        ratio: 画幅比例，如 "16:9"、"9:16"、"1:1"
        need_audio: 是否需要音频（needAudio 参数），默认 True

    Returns:
        (task_prompt, prompt_params) 元组:
        - task_prompt: 纯文本提示词（主体引用处使用显示名称）
        - prompt_params: 完整的 promptParams 字典
    """
    import re as _re

    # Auto-convert 【xxx】 and 【xxx（yyy）】 to {xxx} placeholders
    _paren_suffix = _re.compile(r'[（(].+?[）)]$')
    def _bracket_to_brace(m):
        raw = m.group(1)
        base_name = _paren_suffix.sub('', raw).strip()
        return f'{{{base_name}}}'
    prompt = _re.sub(r'【([^】]+)】', _bracket_to_brace, prompt)
    ts = str(int(time.time() * 1000))

    # 构建 multi_param
    multi_param = []
    for subj in subjects:
        eid = subj["element_id"]
        name = subj.get("name", eid)
        desc = subj.get("desc", "")
        multi_param.append({
            "subjectNo": eid,
            "subjectName": f"{name} - {desc}" if desc else name,
            "referenceType": "SUBJECT",
            "resources": [
                {
                    "type": "SUBJECT",
                    "element_id": eid,
                }
            ],
        })

    # 构建 richTaskPrompt 和 taskPrompt
    # 解析 prompt 中的 {name} 占位符，替换为主体引用
    subject_map = {s["name"]: s for s in subjects}
    rich_resources = []
    task_prompt_parts = []

    # 用正则分割 prompt：{xxx} 为主体占位符，其余为文本
    parts = _re.split(r'\{([^}]+)\}', prompt)

    has_placeholder = len(parts) > 1

    if not has_placeholder:
        # 没有占位符 → 所有主体插入开头，prompt 作为描述文本
        for i, subj in enumerate(subjects):
            eid = subj["element_id"]
            name = subj.get("name", eid)
            mention_ts = str(int(time.time() * 1000) + i)
            rich_resources.append({
                "id": f"mention-{mention_ts}",
                "type": "subject",
                "value": eid,
                "displayName": name,
            })
            task_prompt_parts.append(name)
        # 主体名称后加空格再接描述
        text_value = " " + prompt if rich_resources else prompt
        text_ts = str(int(time.time() * 1000) + len(subjects))
        rich_resources.append({
            "id": f"text-after-{text_ts}",
            "type": "text",
            "value": text_value,
        })
        task_prompt_parts.append(text_value)
    else:
        # 有占位符 → 按位置拆解
        for idx, part in enumerate(parts):
            if idx % 2 == 0:
                # 文本片段
                if part:
                    text_ts = str(int(time.time() * 1000) + idx)
                    rich_resources.append({
                        "id": f"text-after-{text_ts}",
                        "type": "text",
                        "value": part,
                    })
                    task_prompt_parts.append(part)
            else:
                # 主体名称
                subj = subject_map.get(part)
                if subj:
                    eid = subj["element_id"]
                    name = subj.get("name", eid)
                    mention_ts = str(int(time.time() * 1000) + idx)
                    rich_resources.append({
                        "id": f"mention-{mention_ts}",
                        "type": "subject",
                        "value": eid,
                        "displayName": name,
                    })
                    task_prompt_parts.append(name)
                else:
                    # 未知主体名，当作普通文本
                    text_ts = str(int(time.time() * 1000) + idx)
                    rich_resources.append({
                        "id": f"text-after-{text_ts}",
                        "type": "text",
                        "value": f"{{{part}}}",
                    })
                    task_prompt_parts.append(f"{{{part}}}")

    rich_task_prompt = [{"label": "", "resource": rich_resources}]
    task_prompt = "".join(task_prompt_parts)

    # 首帧注入：同场景上一个 clip 最后镜头首帧的模糊图（COS 相对路径）
    frames = []
    if first_frame_url:
        frames = [{"url": first_frame_url, "prompt": first_frame_text or "", "time": "0"}]

    prompt_params = {
        "quality": quality,
        "generated_time": duration,
        "ratio": ratio,
        "frames": frames,
        "prompt": "",
        "reference_video": True,
        "audio": audio,
        "generated_mode": "multi_param",
        "multi_param": multi_param,
        "multi_prompt": [],
        "richTaskPrompt": rich_task_prompt,
    }

    return task_prompt, prompt_params


_COS_DOMAIN = "https://huimeng-1351980869.cos.ap-beijing.myqcloud.com"

_CONTENT_TYPE_MAP = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif",  "webp": "image/webp", "bmp": "image/bmp",
    "mp4": "video/mp4",  "mov": "video/quicktime",
    "avi": "video/x-msvideo", "mkv": "video/x-matroska", "webm": "video/webm",
}


def _sha1_hex(data: str) -> str:
    return hashlib.sha1(data.encode()).hexdigest()


def _hmac_sha1_hex(key: str, msg: str) -> str:
    return hmac.new(key.encode(), msg.encode(), hashlib.sha1).hexdigest()


def _build_cos_auth(secret_id, secret_key, method, uri_path, query_params, headers):
    now = int(time.time())
    q_sign_time = f"{now};{now + 900}"
    sign_key = _hmac_sha1_hex(secret_key, q_sign_time)
    sorted_header_keys = sorted(k.lower() for k in headers)
    header_str = "&".join(
        f"{k}={urllib.parse.quote(str(headers[k]), safe='')}"
        for k in sorted(headers.keys(), key=str.lower)
    )
    sorted_param_keys = sorted(k.lower() for k in query_params)
    param_str = "&".join(
        f"{k}={urllib.parse.quote(str(query_params[k]), safe='')}"
        for k in sorted(query_params.keys(), key=str.lower)
    )
    http_string = f"{method.lower()}\n{uri_path}\n{param_str}\n{header_str}\n"
    string_to_sign = f"sha1\n{q_sign_time}\n{_sha1_hex(http_string)}\n"
    signature = _hmac_sha1_hex(sign_key, string_to_sign)
    header_list = ";".join(sorted_header_keys)
    param_list = ";".join(sorted_param_keys)
    return (
        f"q-sign-algorithm=sha1&q-ak={secret_id}"
        f"&q-sign-time={q_sign_time}&q-key-time={q_sign_time}"
        f"&q-header-list={header_list}&q-url-param-list={param_list}"
        f"&q-signature={signature}"
    )


def upload_to_cos(file_path: str, scene_type: str = "agent-material") -> Optional[str]:
    """Upload a file to COS and return its full public URL, or None on failure."""
    if not os.path.exists(file_path):
        print(f"[WARN] File not found, skipping COS upload: {file_path}", file=sys.stderr)
        return None
    try:
        config = _load_config()
        group_id = config.get("groupId", "")
        token = get_token()

        resp = api_request(
            f"{BASE_URL}/api/anime/workbench/TencentCloud/getSecret",
            data=json.dumps({"sceneType": scene_type, "groupId": group_id, "projectNo": ""}).encode("utf-8"),
            method="POST",
            token=token,
        )
        if resp.get("code") != 200:
            print(f"[WARN] Failed to get COS credentials: {resp.get('msg')}", file=sys.stderr)
            return None
        credential = resp["data"]

        creds = credential.get("credentials", credential)
        tmp_secret_id = creds["tmpSecretId"]
        tmp_secret_key = creds["tmpSecretKey"]
        session_token = creds["sessionToken"]
        bucket = credential.get("bucket", "huimeng-1351980869")
        region = credential.get("region", "ap-beijing")
        cos_path = credential.get("path", f"material/upload/{group_id}/")
        if not cos_path.endswith("/"):
            cos_path += "/"

        ext = os.path.splitext(file_path)[1].lstrip(".").lower()
        filename = f"{uuid.uuid4()}.{ext}"
        ts_ms = int(time.time() * 1000)
        rand = random.randint(100000, 999999)
        object_key = f"{cos_path}upload-{ts_ms}-{rand}-{filename}"
        content_type = _CONTENT_TYPE_MAP.get(ext, "application/octet-stream")

        host = f"{bucket}.cos.{region}.myqcloud.com"
        object_key_enc = urllib.parse.quote(object_key, safe="/")
        cos_url = f"https://{host}/{object_key_enc}"
        uri_path = f"/{object_key}"
        headers_to_sign = {
            "content-type": content_type,
            "host": host,
            "x-cos-acl": "public-read",
            "x-cos-security-token": session_token,
        }
        cos_auth = _build_cos_auth(tmp_secret_id, tmp_secret_key, "PUT", uri_path, {}, headers_to_sign)

        with open(file_path, "rb") as f:
            file_data = f.read()

        req = urllib.request.Request(cos_url, data=file_data, method="PUT")
        req.add_header("Content-Type", content_type)
        req.add_header("Host", host)
        req.add_header("Authorization", cos_auth)
        req.add_header("x-cos-acl", "public-read")
        req.add_header("x-cos-security-token", session_token)

        with urllib.request.urlopen(req, timeout=120) as resp_cos:
            if resp_cos.status not in (200, 204):
                print(f"[WARN] COS upload failed, HTTP {resp_cos.status}", file=sys.stderr)
                return None

        return cos_url

    except Exception as e:
        print(f"[WARN] COS upload error: {e}", file=sys.stderr)
        return None


# ============================================================
# COS URL helpers
# ============================================================

def _cos_relative_url(full_url: str) -> str:
    """将完整 COS URL 转换为相对路径（去掉域名和 query string）。"""
    if full_url.startswith(_COS_DOMAIN):
        path = full_url[len(_COS_DOMAIN):]
    else:
        path = full_url
    return path.split("?")[0]


def build_image_reference_params(
    prompt: str,
    reference_images: List[Dict],
    duration: str = "6",
    quality: str = "720",
    audio: bool = True,
    ratio: str = "16:9",
    need_audio: bool = True,
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
    reference_videos: List[Dict] = None,
) -> tuple:
    """构建图片参考模式（IMAGE）的 promptParams 和 taskPrompt。

    Args:
        prompt: 提示词，可含 {act_001} 等占位符与图片对应。
        reference_images: 参考图片列表，每项:
            {"url": "https://...", "name": "act_001", "display_name": "钟离书雨"}
            name 用于匹配 prompt 中的 {name} 占位符；
            display_name 用于 subjectName 展示（可选，默认同 name）。

    Returns:
        (task_prompt, prompt_params) 元组。
    """
    import re as _re

    ts = str(int(time.time() * 1000))

    multi_param = []
    subject_map = {}
    for i, img in enumerate(reference_images):
        name = img.get("name", f"图片{i+1}")
        display_name = img.get("display_name") or name
        cos_url = _cos_relative_url(img["url"])
        subject_no = f"ref-{ts}-{i}"
        resource = {"type": "IMAGE", "url": cos_url}
        multi_param.append({
            "subjectNo": subject_no,
            "subjectName": display_name,
            "referenceType": "IMAGE",
            "resources": [resource],
        })
        subject_map[name] = {"subject_no": subject_no, "display_name": display_name}

    # Append video references (referenceType: VIDEO) — e.g., previous clip video
    if reference_videos:
        for j, vid in enumerate(reference_videos):
            vid_name = vid.get("name", f"视频{j+1}")
            vid_display = vid.get("display_name") or vid_name
            cos_url_v = _cos_relative_url(vid["url"])
            subject_no_v = f"ref-vid-{ts}-{j}"
            multi_param.append({
                "subjectNo": subject_no_v,
                "subjectName": vid_display,
                "referenceType": "VIDEO",
                "resources": [{"type": "VIDEO", "url": cos_url_v}],
            })

    parts = _re.split(r'\{([^}]+)\}', prompt)
    has_placeholder = len(parts) > 1
    rich_resources = []
    task_prompt_parts = []

    if not has_placeholder:
        for i, img in enumerate(reference_images):
            subject_no = f"ref-{ts}-{i}"
            display_name = img.get("display_name") or img.get("name", f"图片{i+1}")
            mention_ts = str(int(time.time() * 1000) + i)
            rich_resources.append({
                "id": f"mention-{mention_ts}",
                "type": "image",
                "value": subject_no,
                "displayName": display_name,
            })
            task_prompt_parts.append(display_name)
        text_value = " " + prompt if rich_resources else prompt
        text_ts = str(int(time.time() * 1000) + len(reference_images))
        rich_resources.append({"id": f"text-after-{text_ts}", "type": "text", "value": text_value})
        task_prompt_parts.append(text_value)
    else:
        for idx, part in enumerate(parts):
            if idx % 2 == 0:
                if part:
                    text_ts = str(int(time.time() * 1000) + idx)
                    rich_resources.append({"id": f"text-after-{text_ts}", "type": "text", "value": part})
                    task_prompt_parts.append(part)
            else:
                entry = subject_map.get(part)
                if entry:
                    mention_ts = str(int(time.time() * 1000) + idx)
                    rich_resources.append({
                        "id": f"mention-{mention_ts}",
                        "type": "image",
                        "value": entry["subject_no"],
                        "displayName": entry["display_name"],
                    })
                    task_prompt_parts.append(entry["display_name"])
                else:
                    text_ts = str(int(time.time() * 1000) + idx)
                    rich_resources.append({"id": f"text-after-{text_ts}", "type": "text", "value": f"{{{part}}}"})
                    task_prompt_parts.append(f"{{{part}}}")

    rich_task_prompt = [{"label": "", "resource": rich_resources}]
    task_prompt = "".join(task_prompt_parts)

    # 首帧注入：同场景上一个 clip 最后镜头首帧的模糊图（COS 相对路径）
    frames = []
    if first_frame_url:
        frames = [{"url": first_frame_url, "prompt": first_frame_text or "", "time": "0"}]

    prompt_params = {
        "quality": quality,
        "generated_time": duration,
        "ratio": ratio,
        "frames": frames,
        "prompt": "",
        "reference_video": True,
        "audio": audio,
        "needAudio": need_audio,
        "generated_mode": "multi_param",
        "multi_param": multi_param,
        "multi_prompt": [],
        "richTaskPrompt": rich_task_prompt,
    }

    return task_prompt, prompt_params


# ============================================================
# 提交任务（来源: video-create/scripts/submit_video_create.py）
# ============================================================

def submit_video_task(
    model_code: str,
    prompt: str,
    prompt_params: dict = None,
    handle_code: str = "",
    model_group_code: str = "",
    token: str = None
) -> str:
    """提交视频生成任务，返回 task_id。

    Args:
        model_code: 模型编码（如 "KeLing3_Omni_VideoCreate_tencent"）
        prompt: 任务提示词
        prompt_params: 提示词参数字典
        handle_code: 处理器编码（可选）
        model_group_code: 模型组编码（如 "KeLing3_VideoCreate_Group"）
        token: Bearer Token（可选，默认自动获取）

    Returns:
        task_id 字符串
    """
    # Safety: truncate taskPrompt to 2500 chars (KeLing API hard limit)
    if len(prompt) > 2500:
        print(f"[WARN] taskPrompt 超长 ({len(prompt)} chars)，截断到 2500")
        prompt = prompt[:2500]

    body = {
        "modelCode": model_code,
        "taskPrompt": prompt,
        "promptParams": prompt_params or {},
        "bizScenarioParams": {"enableBattle": False},
    }
    if handle_code:
        body["handleCode"] = handle_code
    if model_group_code:
        body["modelGroupCode"] = model_group_code

    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    url = f"{BASE_URL}/api/material/creation/videoCreate"
    result = api_request(url, data=data, method="POST", token=token)

    task_id = result.get("data")
    if not task_id:
        raise RuntimeError(f"未获取到 taskId，API 响应: {result}")

    return str(task_id)


# ============================================================
# 轮询任务（来源: video-create/scripts/poll_video_create_task.py）
# ============================================================

def poll_video_task(
    task_id: str,
    interval: int = 10,
    timeout: int = 1830,
    token: str = None
) -> Dict:
    """轮询视频生成任务状态，直至完成或超时。

    Args:
        task_id: 任务ID
        interval: 轮询间隔（秒）
        timeout: 超时时间（秒）
        token: Bearer Token（可选）

    Returns:
        任务结果字典，包含 status, resultFileList, resultFileDisplayList 等

    Raises:
        RuntimeError: 任务失败或超时
    """
    start = time.time()
    attempt = 0
    consecutive_errors = 0

    while True:
        attempt += 1
        elapsed = time.time() - start
        if elapsed > timeout:
            raise RuntimeError(f"轮询超时：已超过 {timeout} 秒，任务仍未完成")

        try:
            url = f"{BASE_URL}/api/material/creation/videoCreateGet?taskId={task_id}"
            resp = api_request(url, method="GET", token=token)
        except Exception as e:
            consecutive_errors += 1
            print(f"[{attempt:>3}] [WARN] 请求异常 ({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {e}",
                  file=sys.stderr)
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                raise RuntimeError(f"连续 {MAX_CONSECUTIVE_ERRORS} 次请求失败，停止轮询") from e
            time.sleep(interval)
            continue

        if resp.get("code") != 200:
            consecutive_errors += 1
            print(f"[{attempt:>3}] [WARN] 接口返回错误 ({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {resp.get('msg')}",
                  file=sys.stderr)
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                raise RuntimeError(f"连续 {MAX_CONSECUTIVE_ERRORS} 次接口错误，停止轮询")
            time.sleep(interval)
            continue

        consecutive_errors = 0
        data = resp.get("data", {})
        status = data.get("taskStatus", "UNKNOWN")
        queue_num = data.get("taskQueueNum") or "-"

        print(f"[{attempt:>3}] 状态: {status:<12} 队列: {queue_num:<5} 耗时: {elapsed:.1f}s")

        if status in TERMINAL_STATUSES:
            if status == "SUCCESS":
                return data
            else:
                error_msg = data.get("errorMsg", "未知错误")
                raise RuntimeError(f"视频生成失败: {error_msg}")

        time.sleep(interval)


# ============================================================
# 下载视频
# ============================================================

def download_video(url: str, output_path: str) -> str:
    """下载视频文件到本地路径。

    Args:
        url: 视频下载 URL
        output_path: 本地保存路径

    Returns:
        保存的文件路径
    """
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    urllib.request.urlretrieve(url, output_path)
    return output_path


# ============================================================
# 一站式接口
# ============================================================

def create_video(
    prompt: str,
    model_code: str = DEFAULT_MODEL_CODE,
    model_group_code: str = "",
    prompt_params: dict = None,
    subjects: List[Dict] = None,
    reference_images: List[Dict] = None,
    duration: str = "6",
    quality: str = "720",
    ratio: str = "16:9",
    need_audio: bool = True,
    output_path: str = None,
    timeout: int = 1830,
    poll_interval: int = 10
) -> Dict:
    """一站式接口：提交 -> 轮询 -> 下载。

    支持三种模式：
    1. 主体参考模式：传 prompt + subjects（可灵3.0 Omni）
    2. 图片参考模式：传 prompt + reference_images（即梦 Seedance 2 等）
    3. 普通模式：直接传 prompt + prompt_params

    Args:
        prompt: 视频提示词。可用 {名称} 占位对应主体或参考图。
        model_code: 模型编码
        model_group_code: 模型分组编码
        prompt_params: 提示词参数（可选，普通模式使用）
        subjects: 主体列表（可选，传入则启用主体参考模式）。
                  每项: {"element_id": "ext_xxx", "name": "萧禾", "desc": "..."}
        reference_images: 参考图片列表（可选，传入则启用图片参考模式）。
                  每项: {"url": "https://...", "name": "act_001", "display_name": "钟离书雨"}
        duration: 视频时长秒数，如 "6"
        quality: 视频质量，如 "720"
        need_audio: 是否需要音频，默认 True
        output_path: 视频保存路径（可选，不提供则不下载）
        timeout: 超时时间（秒）
        poll_interval: 轮询间隔（秒）

    Returns:
        结果字典:
        {
            "success": bool,
            "task_id": str,
            "video_url": str or None,
            "video_path": str or None,
            "message": str,
            "result_data": dict  # API 原始返回数据
        }
    """
    try:
        if subjects:
            # 主体参考模式（可灵3.0 Omni）
            task_prompt, final_params = build_subject_prompt_params(
                prompt=prompt,
                subjects=subjects,
                duration=duration,
                quality=quality,
                ratio=ratio,
                need_audio=need_audio,
            )
            print(f"[MODE] 可灵3.0 Omni 主体参考模式，引用 {len(subjects)} 个主体")
        elif reference_images:
            # 图片参考模式（即梦 Seedance 2 等）
            task_prompt, final_params = build_image_reference_params(
                prompt=prompt,
                reference_images=reference_images,
                duration=duration,
                quality=quality,
                ratio=ratio,
                need_audio=need_audio,
            )
            print(f"[MODE] 图片参考模式，引用 {len(reference_images)} 张参考图")
        else:
            task_prompt = prompt
            final_params = prompt_params or {}
            # Ensure all parameters are set in plain text mode
            if "ratio" not in final_params and ratio:
                final_params["ratio"] = ratio
            if "quality" not in final_params and quality:
                final_params["quality"] = quality
            if "generated_time" not in final_params and duration:
                final_params["generated_time"] = duration
            if "audio" not in final_params:
                final_params["audio"] = need_audio

        if model_group_code:
            group_code = model_group_code
        else:
            # Auto-fetch modelGroupCode
            group_code = fetch_model_group_code(model_code)
        if group_code:
            print(f"[INFO] modelGroupCode: {group_code}")

        # 1. 提交任务
        print(f"[SUBMIT] 提交视频生成任务...")
        task_id = submit_video_task(
            model_code=model_code,
            prompt=task_prompt,
            prompt_params=final_params,
            model_group_code=group_code,
        )
        print(f"[OK] 任务已提交: {task_id}")

        # 2. 轮询等待完成
        print(f"[POLL] 等待视频生成完成...")
        result_data = poll_video_task(
            task_id=task_id,
            interval=poll_interval,
            timeout=timeout,
        )
        print(f"[OK] 视频生成完成!")

        # 3. 提取视频 URL
        video_url = None
        files = result_data.get("resultFileList") or []
        display_files = result_data.get("resultFileDisplayList") or []

        # 优先从 resultFileList 获取 .mp4 URL
        for f in files:
            if isinstance(f, str) and ".mp4" in f:
                video_url = f
                break

        # 备选：从 resultFileDisplayList 获取
        if not video_url:
            for f in display_files:
                if isinstance(f, str) and ".mp4" in f:
                    video_url = f
                    break

        # 备选：取第一个文件
        if not video_url and files:
            video_url = files[0] if isinstance(files[0], str) else None

        # 4. 下载视频（如果提供了输出路径）
        video_path = None
        if video_url and output_path:
            try:
                print(f"[DOWNLOAD] 下载视频到: {output_path}")
                video_path = download_video(video_url, output_path)
                print(f"[OK] 视频已保存: {video_path}")
            except Exception as e:
                print(f"[WARN] 下载失败: {e}", file=sys.stderr)

        return {
            "success": True,
            "task_id": task_id,
            "video_url": video_url,
            "video_path": video_path,
            "message": "视频生成成功",
            "result_data": result_data,
        }

    except Exception as e:
        return {
            "success": False,
            "task_id": locals().get("task_id"),
            "video_url": None,
            "video_path": None,
            "message": str(e),
            "result_data": None,
        }


def submit_video(
    prompt: str,
    model_code: str = DEFAULT_MODEL_CODE,
    model_group_code: str = "",
    subjects: List[Dict] = None,
    reference_images: List[Dict] = None,
    duration: str = "6",
    quality: str = "720",
    ratio: str = "16:9",
    need_audio: bool = True,
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
    reference_videos: List[Dict] = None,
) -> Dict:
    """只提交任务，不等待完成。返回 {"success": bool, "task_id": str, "message": str}。"""
    try:
        if subjects:
            task_prompt, final_params = build_subject_prompt_params(
                prompt=prompt, subjects=subjects,
                duration=duration, quality=quality, ratio=ratio, need_audio=need_audio,
                first_frame_url=first_frame_url,
                first_frame_text=first_frame_text,
            )
        elif reference_images or reference_videos:
            task_prompt, final_params = build_image_reference_params(
                prompt=prompt, reference_images=reference_images or [],
                duration=duration, quality=quality, ratio=ratio, need_audio=need_audio,
                first_frame_url=first_frame_url,
                first_frame_text=first_frame_text,
                reference_videos=reference_videos,
            )
        else:
            task_prompt = prompt
            final_params = {"quality": quality, "generated_time": duration, "ratio": ratio, "audio": need_audio}

        group_code = model_group_code or fetch_model_group_code(model_code)
        task_id = submit_video_task(
            model_code=model_code, prompt=task_prompt,
            prompt_params=final_params, model_group_code=group_code,
        )
        return {"success": True, "task_id": task_id, "message": "已提交"}
    except Exception as e:
        return {"success": False, "task_id": None, "message": str(e)}


def poll_multiple_tasks(
    tasks: List[Dict],
    interval: int = 10,
    timeout: int = 1830,
    on_complete: callable = None,
) -> List[Dict]:
    """批量轮询多个任务直至全部完成或超时。

    Args:
        tasks: [{"task_id": str, "output_path": str, ...}]
        interval: 轮询间隔秒数
        timeout: 超时秒数

    Returns:
        与 tasks 同序的结果列表，每项增加 success/video_url/video_path/message
    """
    start = time.time()
    pending = {t["task_id"]: dict(t, success=None) for t in tasks if t.get("task_id")}
    finished = {}

    while pending:
        elapsed = time.time() - start
        if elapsed > timeout:
            for tid, info in pending.items():
                info.update(success=False, message=f"轮询超时 ({timeout}s)", video_url=None, video_path=None)
                finished[tid] = info
            pending.clear()
            break

        for tid in list(pending.keys()):
            try:
                url = f"{BASE_URL}/api/material/creation/videoCreateGet?taskId={tid}"
                resp = api_request(url, method="GET")
                data = resp.get("data", {})
                status = data.get("taskStatus", "UNKNOWN")

                if status == "SUCCESS":
                    video_url = None
                    for f in (data.get("resultFileList") or []):
                        if isinstance(f, str) and ".mp4" in f:
                            video_url = f
                            break
                    if not video_url:
                        for f in (data.get("resultFileDisplayList") or []):
                            if isinstance(f, str) and ".mp4" in f:
                                video_url = f
                                break
                    if not video_url and (data.get("resultFileList") or []):
                        video_url = data["resultFileList"][0]

                    video_path = None
                    out = pending[tid].get("output_path")
                    if video_url and out:
                        try:
                            video_path = download_video(video_url, out)
                        except Exception as e:
                            print(f"[WARN] 下载失败 {tid}: {e}", file=sys.stderr)

                    pending[tid].update(success=True, video_url=video_url, video_path=video_path, message="成功")
                    finished[tid] = pending.pop(tid)
                    print(f"[OK] {tid} 完成 -> {video_path or video_url}", flush=True)
                    if on_complete:
                        try:
                            on_complete(finished[tid])
                        except Exception as e:
                            print(f"[WARN] on_complete 回调失败: {e}", file=sys.stderr)
                elif status in ("FAIL", "FAILED"):
                    pending[tid].update(success=False, message=data.get("errorMsg", "生成失败"), video_url=None, video_path=None)
                    finished[tid] = pending.pop(tid)
                    print(f"[FAIL] {tid}: {data.get('errorMsg', '?')}")
            except Exception as e:
                pass  # 网络瞬时错误，下次重试

        if pending:
            queue_info = f"剩余 {len(pending)} 个任务, 已完成 {len(finished)}, 耗时 {elapsed:.0f}s"
            print(f"[POLL] {queue_info}")
            time.sleep(interval)

    # 按原始 tasks 顺序返回
    result_map = {**finished}
    results = []
    for t in tasks:
        tid = t.get("task_id")
        if tid and tid in result_map:
            results.append(result_map[tid])
        else:
            results.append(dict(t, success=False, message="未提交成功", video_url=None, video_path=None))
    return results
    import argparse

    parser = argparse.ArgumentParser(description="AnimeWorkbench 视频生成 API 客户端")
    parser.add_argument("--prompt", required=True, help="视频提示词")
    parser.add_argument("--model-code", default="kling-v1.6", help="模型编码")
    parser.add_argument("--handle-code", default="", help="处理器编码")
    parser.add_argument("--prompt-params", default="{}", help="提示词参数 JSON")
    parser.add_argument("--output", "-o", default=None, help="视频保存路径")
    parser.add_argument("--timeout", type=int, default=1830, help="轮询超时时间（秒）")
    parser.add_argument("--interval", type=int, default=10, help="轮询间隔（秒）")
    args = parser.parse_args()

    try:
        prompt_params = json.loads(args.prompt_params)
    except json.JSONDecodeError as e:
        print(f"[ERROR] --prompt-params 不是合法的 JSON: {e}", file=sys.stderr)
        sys.exit(1)

    result = create_video(
        prompt=args.prompt,
        model_code=args.model_code,
        handle_code=args.handle_code,
        prompt_params=prompt_params,
        output_path=args.output,
        timeout=args.timeout,
        poll_interval=args.interval,
    )

    print(f"\n结果: {json.dumps(result, ensure_ascii=False, indent=2, default=str)}")
    sys.exit(0 if result["success"] else 1)
