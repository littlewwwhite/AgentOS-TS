#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common_create_subjects.py - 创建 AnimeWorkbench 主体（Element）的公共模块

供 generate_characters.py / generate_scenes.py / generate_props.py 导入，
在每个资产生成成功后调用 process_actor() 创建对应主体。

process_actor() 核心流程：
  1. 上传正面图到 COS → element_frontal_image（COS 相对路径）
  2. 上传参考图列表到 COS → element_refer_list（image_refer 时）
  3. 上传音频 → 创建音色 → 轮询获取 voice_external_id（可选）
  4. 创建主体 → 轮询确认 → 返回 element_id
"""

import sys, os, json, time, uuid, hashlib, hmac, random
import urllib.parse, urllib.request, urllib.error
from pathlib import Path

# ── auth 模块（awb-login skill 提供）─────────────────────────────────────────
_SKILLS_DIR = Path(__file__).parent.parent.parent   # .claude/skills/
from common_config import get_shared_auth_path
sys.path.insert(0, str(get_shared_auth_path()))
import auth

# ── 配置 ──────────────────────────────────────────────────────────────────────
BASE_URL         = os.environ.get("AWB_BASE_URL", "https://animeworkbench.lingjingai.cn").rstrip("/")
MATERIAL_URL     = f"{BASE_URL}/api/material"
POLL_INTERVAL    = 5    # 秒
POLL_MAX_VOICE   = 12 * 10   # 最多等待 10 分钟
POLL_MAX_ELEMENT = 12 * 10   # 最多等待 10 分钟

CONTENT_TYPE_MAP = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif",  "webp": "image/webp", "bmp": "image/bmp",
    "mp4": "video/mp4",  "mov": "video/quicktime",
    "avi": "video/x-msvideo", "mkv": "video/x-matroska", "webm": "video/webm",
}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ── COS 上传工具 ───────────────────────────────────────────────────────────────

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
    param_list  = ";".join(sorted_param_keys)
    return (
        f"q-sign-algorithm=sha1&q-ak={secret_id}"
        f"&q-sign-time={q_sign_time}&q-key-time={q_sign_time}"
        f"&q-header-list={header_list}&q-url-param-list={param_list}"
        f"&q-signature={signature}"
    )


def upload_to_cos(file_path, scene_type="material-image-edit"):
    """
    上传文件到 COS，返回 (cos_url, relative_key) 或 (None, None)

    cos_url       — 完整 URL（用于音色 voiceUrl）
    relative_key  — 相对路径（用于图片 elementFrontalImage）
    """
    file_path = str(file_path)
    if not os.path.exists(file_path):
        log(f"  ❌ 文件不存在: {file_path}")
        return None, None

    try:
        # 1. 获取 COS 临时凭证
        user_info = auth.get_user_info()
        group_id  = user_info["groupId"]
        resp = auth.api_request(
            f"{BASE_URL}/api/anime/workbench/TencentCloud/getSecret",
            data=json.dumps({"sceneType": scene_type, "groupId": group_id, "projectNo": ""}).encode("utf-8"),
            method="POST",
        )
        if resp.get("code") != 200:
            log(f"  ❌ 获取 COS 凭证失败: {resp.get('msg')}")
            return None, None
        credential = resp["data"]

        # 2. 解析凭证
        creds          = credential.get("credentials", credential)
        tmp_secret_id  = creds["tmpSecretId"]
        tmp_secret_key = creds["tmpSecretKey"]
        session_token  = creds["sessionToken"]
        bucket   = credential.get("bucket", "huimeng-1351980869")
        region   = credential.get("region", "ap-beijing")
        cos_path = credential.get("path", f"material/upload/{group_id}/")
        if not cos_path.endswith("/"):
            cos_path += "/"

        # 3. 构造 object_key
        ext = os.path.splitext(file_path)[1].lstrip(".").lower()
        filename = f"{uuid.uuid4()}.{ext}"
        # filename     = os.path.basename(file_path)
        ts_ms        = int(time.time() * 1000)
        rand         = random.randint(100000, 999999)
        object_key   = f"{cos_path}upload-{ts_ms}-{rand}-{filename}"
        # ext          = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        content_type = CONTENT_TYPE_MAP.get(ext, "application/octet-stream")

        # 4. 上传到 COS
        host             = f"{bucket}.cos.{region}.myqcloud.com"
        object_key_enc   = urllib.parse.quote(object_key, safe="/")
        cos_url          = f"https://{host}/{object_key_enc}"
        uri_path         = f"/{object_key}"
        headers_to_sign  = {
            "content-type":         content_type,
            "host":                 host,
            "x-cos-acl":            "public-read",
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

        with urllib.request.urlopen(req, timeout=60) as resp_cos:
            if resp_cos.status not in (200, 204):
                log(f"  ❌ COS 上传失败，HTTP {resp_cos.status}")
                return None, None

        return cos_url, object_key

    except Exception as e:
        log(f"  ❌ 上传异常: {e}")
        return None, None


# ── 音色 ──────────────────────────────────────────────────────────────────────

def create_voice(voice_name, voice_url):
    """提交创建音色任务，返回是否成功"""
    try:
        data = {"voiceName": voice_name, "voiceUrl": voice_url}
        result = auth.api_request(
            f"{MATERIAL_URL}/creation/createVoice",
            data=json.dumps(data, ensure_ascii=False).encode("utf-8"),
            method="POST",
        )
        if result.get("code") == 200:
            return str(result["data"])
        log(f"  ❌ create-voice 返回异常: {result}")
        return False
    except Exception as e:
        log(f"  ❌ create-voice 调用失败: {e}")
        return False


def poll_voice(req_task_id):
    """轮询直到音色创建完成，返回 externalId 或 None"""
    for i in range(POLL_MAX_VOICE):
        try:
            result = auth.api_request(
                f"{MATERIAL_URL}/creation/getVoiceByReqTaskId?reqTaskId={req_task_id}",
                method="GET",
            )
            data = result.get("data") if result.get("code") == 200 else None
            if data and data.get("externalId"):
                return data["externalId"]
        except Exception:
            pass
        log(f"  ⏳ 等待音色完成... ({i + 1}/{POLL_MAX_VOICE})")
        time.sleep(POLL_INTERVAL)
    log("  ❌ 音色创建超时")
    return None


# ── 主体 ──────────────────────────────────────────────────────────────────────

def _cos_url_to_key(url: str) -> str:
    """
    将 COS 完整签名 URL 转换为相对路径。
    https://huimeng-xxx.cos.ap-beijing.myqcloud.com/material/image-draw/.../file.png?sign=...
    → material/image-draw/.../file.png
    如果已经是相对路径则直接返回。
    """
    if not url or not url.startswith("http"):
        return url
    parsed = urllib.parse.urlparse(url)
    # 去掉开头的 '/'，去掉查询参数
    return parsed.path.lstrip("/")


def create_element(element_name, element_description, reference_type,
                   element_frontal_image, element_refer_list,
                   element_video_list, voice_external_id, model_code="tx"):
    """
    提交创建主体任务，返回是否成功。

    :param element_frontal_image: COS URL 或相对路径（自动转换为相对路径）
    :param element_refer_list:    列表，如 [{"imageUrl":"..."}]（URL 自动转换）
    :param element_video_list:    列表，如 [{"videoUrl":"..."}]（URL 自动转换）
    :param model_code:            模型编码，默认 "tx"
    """
    try:
        data = {
            "elementName":        element_name,
            "elementDescription": element_description,
            "modelCode":          model_code,
            "referenceType":      reference_type,
            # "reqTaskId":          req_task_id,
        }
        if element_frontal_image:
            data["elementFrontalImage"] = element_frontal_image
        if element_refer_list:
            refer = element_refer_list if isinstance(element_refer_list, list) \
                else json.loads(element_refer_list)
            data["elementReferList"] = refer
        if element_video_list:
            videos = element_video_list if isinstance(element_video_list, list) \
                else json.loads(element_video_list)
            data["elementVideoList"] = videos
        if voice_external_id:
            data["elementVoiceId"] = voice_external_id

        log(f"  [DEBUG] createElement data: {json.dumps(data, ensure_ascii=False)}")
        print(f"{MATERIAL_URL}/creation/createElement")
        print(data)
        result = auth.api_request(
            f"{MATERIAL_URL}/creation/createElement",
            data=json.dumps(data, ensure_ascii=False).encode("utf-8"),
            method="POST",
        )
        log(f"  ⏳ 触发主体创建... ({result})")
        if result.get("code") == 200:
            return str(result["data"])
        log(f"  ❌ create-element 返回异常: {result}")
        return None
    except Exception as e:
        log(f"  ❌ create-element 调用失败: {e}")
        return None


def poll_element(req_task_id):
    """轮询直到主体创建完成，返回 element data 或 None"""
    for i in range(POLL_MAX_ELEMENT):
        try:
            result = auth.api_request(
                f"{MATERIAL_URL}/creation/getElementByReqTaskId?reqTaskId={req_task_id}",
                method="GET",
            )
            log(f"  ⏳ 等待主体创建... 响应: {result}")
            data = result.get("data") if result.get("code") == 200 else None
            if data and data.get("externalId"):
                return data.get("externalId")
        except Exception:
            pass
        log(f"  ⏳ 等待主体创建... ({i + 1}/{POLL_MAX_ELEMENT})")
        time.sleep(POLL_INTERVAL)
    log("  ❌ 主体创建超时")
    return None


# ── 单角色处理 ────────────────────────────────────────────────────────────────

def process_actor(element_name, element_description, element_frontal_image, dry_run,
                  voice_path=None, reference_type="image_refer", element_refer_list=None, element_video_list=None):
    """
    为单个主体上传资产并创建主体，返回 element_id 或 None。

    上传阶段（本地路径 → COS）：
      element_frontal_image  → COS relative key（image_refer 时上传）
      element_refer_list     → COS relative keys 列表（image_refer 时上传）
      voice_path             → create_voice → voice_external_id

    创建阶段（调用 auth.api_request）：
      element_name, element_description, reference_type,
      element_frontal_image, element_refer_list,
      element_video_list, voice_external_id

    :param element_frontal_image: 正面图本地路径（Path），image_refer 时必填
    :param element_refer_list:    参考图本地路径列表（list[Path]），可包含正面图
    :param voice_path:            本地音频路径（Path）或 None
    :param reference_type:        "image_refer"（默认）或 "video_refer"
    :param element_video_list:    video_refer 时的视频列表 [{"videoUrl":"..."}]
    """
    log(f"\n── 处理角色: {element_name} ──")

    if dry_run:
        log(f"  [dry-run] 正面图: {element_frontal_image}")
        log(f"  [dry-run] 参考图: {[str(p) for p in (element_refer_list or [])]}")
        log(f"  [dry-run] 音频: {voice_path}")
        log(f"  [dry-run] 创建主体: {element_name} / {element_description}")
        return "dry-run-id"
    element_description = element_description[:90]
    def _is_url(val):
        return isinstance(val, str) and val.startswith("http")

    uploaded_frontal = None
    uploaded_refer   = None
    uploaded_videos  = None

    if reference_type == "image_refer":
        # 1a. 正面图：URL → 转相对路径；非 URL → 直接使用，不处理
        if element_frontal_image:
            if _is_url(element_frontal_image):
                uploaded_frontal = _cos_url_to_key(element_frontal_image)
                log(f"  ✓ 正面图 URL 转换为相对路径: {uploaded_frontal}")
            else:
                uploaded_frontal = element_frontal_image
                log(f"  ✓ 正面图已是相对路径，直接使用: {uploaded_frontal}")

        # 1b. 参考图列表：URL → 转相对路径；非 URL → 直接使用，不处理
        refer_keys = []
        for ref_path in (element_refer_list or []):
            if _is_url(ref_path):
                cos_key = _cos_url_to_key(ref_path)
                refer_keys.append(cos_key)
                log(f"  ✓ 参考图 URL 转换为相对路径: {cos_key}")
            else:
                refer_keys.append(ref_path)
                log(f"  ✓ 参考图已是相对路径，直接使用: {ref_path}")
        # 当 referenceType 为 image_refer 时，确保至少包含正面图作为参考图
        # 否则 API 会静默失败（返回 task_id 但 externalId 永远为空）
        if not refer_keys and uploaded_frontal:
            refer_keys.append(uploaded_frontal)
            log(f"  ✓ 参考图列表为空，自动添加正面图作为参考: {uploaded_frontal}")
        uploaded_refer = [{"imageUrl": k} for k in refer_keys] if refer_keys else None

    elif reference_type == "video_refer":
        # 视频列表：每项可以是 {"videoUrl": "..."} 或裸字符串，URL → 转相对路径
        video_items = []
        for item in (element_video_list or []):
            if isinstance(item, dict):
                url = item.get("videoUrl", "")
                key = _cos_url_to_key(url) if _is_url(url) else url
                video_items.append({"videoUrl": key})
                log(f"  ✓ 视频 URL 转换为相对路径: {key}")
            elif isinstance(item, str):
                key = _cos_url_to_key(item) if _is_url(item) else item
                video_items.append({"videoUrl": key})
                log(f"  ✓ 视频 URL 转换为相对路径: {key}")
        uploaded_videos = video_items if video_items else None

    # 2. 音频：URL → 直接用于创建音色；非 URL → 不处理
    voice_external_id = None
    if voice_path and _is_url(voice_path):
        voice_path = _cos_url_to_key(voice_path)
        log(f"  ✓ 音频 URL 转换为相对路径: {voice_path}")
        voice_id = create_voice(f"{element_name}_voice", voice_path)
        if not voice_id:
            return None
        voice_external_id = poll_voice(voice_id)
        if voice_external_id:
            log(f"  ✓ 音色创建成功: {voice_external_id}")
        else:
            log(f"  ⚠ 音色创建失败，继续创建主体（不绑定音色）")

    # 3. 创建主体并轮询确认
    log(f"  🔨 提交主体创建: {element_name}")
    element_id = create_element(
        element_name, element_description, reference_type,
        uploaded_frontal, uploaded_refer,
        uploaded_videos,
        voice_external_id
    )
    if not element_id:
        return None

    # 4. 轮询等待主体创建完成
    log(f"  ⏳ 轮询主体创建状态: {element_name}")
    final_element_id = poll_element(element_id)
    if not final_element_id:
        log(f"  ❌ 主体创建轮询失败: {element_name}")
        return None

    log(f"  ✅ 主体创建成功: {element_name} → element_id={final_element_id}")
    return final_element_id

if __name__ == "__main__":
    element_id = process_actor(
        element_name="保镖",
        element_description="鹏飞666",
        element_frontal_image="https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336855610-692980-%E6%AD%A3%E9%9D%A2.png",
        element_refer_list=["https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336855610-692980-%E6%AD%A3%E9%9D%A2.png",
                            "https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336858179-225558-%E8%83%8C%E9%9D%A2.png",
                            "https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336856993-174883-%E4%BE%A7%E9%9D%A2.png"],
        voice_path="https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336928079-334294-voice.mp3",
        dry_run=False
    )
    print(element_id)

#     准备调用
#     process_actor: name = 保镖, desc = - 性别：男性
# - 推断年龄段：青年
# - 年龄段特征：面容轮廓线条锋利，皮肤紧致呈健康的小麦色，颈部, frontal_image_url = https: // huimeng - 1351980869.
# cos.ap - beijing.myqcloud.com / default / workbench / upload - 1773336855610 - 692980 - % E6 % AD % A3 % E9 % 9
# D % A2.png, refer_urls = [
#     'https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336855610-692980-%E6%AD%A3%E9%9D%A2.png',
#     'https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336858179-225558-%E8%83%8C%E9%9D%A2.png',
#     'https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/default/workbench/upload-1773336856993-174883-%E4%BE%A7%E9%9D%A2.png'], voice_url = https: // huimeng - 1351980869.
# cos.ap - beijing.myqcloud.com / default / workbench / upload - 1773336928079 - 334294 - voice.mp3...

