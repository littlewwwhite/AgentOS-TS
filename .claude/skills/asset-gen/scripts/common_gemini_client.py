#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common_gemini_client.py - Gemini 客户端工厂

通过 assets/common/gemini_backend.json 配置决定使用官方 API 还是三方代理：

  {
    "mode": "official",          // "official" | "proxy"
    "official": {
      "api_key": "",
      "api_key_env": "GEMINI_API_KEY"
    },
    "proxy": {
      "api_key":  "",
      "api_key_env": "GEMINI_PROXY_KEY",
      "base_url": "https://your-proxy.example.com"
    }
  }

用法:
  from common_gemini_client import create_client, get_key, get_model

  client = create_client()          # 按配置创建 genai.Client
  key    = get_key()                # 获取当前后端对应的 API Key（用于校验是否已设置）
  model  = get_model()              # 获取当前配置的 Gemini 模型名称
"""

import os, json, time, random, logging
from pathlib import Path
from typing import Optional

from google import genai
from google.genai import types

from common_config import get_config


def _load_backend_config() -> dict:
    return get_config().get('gemini_backend', {})


def _resolve_key(cfg: dict, default_env: str) -> Optional[str]:
    """
    从 cfg 中解析 API Key，优先级：
      1. cfg['api_key']     — 直接写在配置文件里的值
      2. cfg['api_key_env'] — 指向某个环境变量名，再从环境变量读取
      3. 兜底读取 default_env 环境变量
    """
    if cfg.get('api_key'):
        return cfg['api_key']
    env_name = cfg.get('api_key_env', default_env)
    return os.getenv(env_name)


def get_model(backend_config: dict = None) -> str:
    """返回配置的 Gemini 模型名称。"""
    if backend_config is None:
        backend_config = _load_backend_config()
    return backend_config.get('model', 'gemini-2.0-flash')


def get_key(backend_config: dict = None) -> Optional[str]:
    """返回当前后端模式对应的 API Key（可用于校验是否已设置）。"""
    if backend_config is None:
        backend_config = _load_backend_config()
    mode = backend_config.get('mode', 'official')
    if mode == 'proxy':
        return _resolve_key(backend_config.get('proxy', {}), 'GEMINI_PROXY_KEY')
    else:
        return _resolve_key(backend_config.get('official', {}), 'GEMINI_API_KEY')


def create_client(backend_config: dict = None) -> genai.Client:
    """
    根据配置创建 genai.Client。

    - mode=official: 使用 google-genai SDK 直连官方 API
    - mode=proxy:    使用自定义 base_url 转发到三方代理（Gemini API 兼容格式）
    """
    if backend_config is None:
        backend_config = _load_backend_config()
    mode = backend_config.get('mode', 'official')

    if mode == 'proxy':
        proxy_cfg = backend_config.get('proxy', {})
        api_key   = _resolve_key(proxy_cfg, 'GEMINI_PROXY_KEY')
        base_url  = proxy_cfg.get('base_url', '')
        if not api_key:
            raise ValueError('Gemini 代理模式：api_key 未配置（可在 proxy.api_key 或 proxy.api_key_env 中设置）')
        if not base_url:
            raise ValueError('Gemini 代理模式：gemini_backend.proxy.base_url 未配置')
        return genai.Client(api_key=api_key, http_options={'base_url': base_url})
    else:
        official_cfg = backend_config.get('official', {})
        api_key = _resolve_key(official_cfg, 'GEMINI_API_KEY')
        if not api_key:
            raise ValueError('Gemini 官方模式：api_key 未配置（可在 official.api_key 或 official.api_key_env 中设置）')
        return genai.Client(api_key=api_key)


def extract_response_text(response) -> str:
    """从 Gemini 响应中提取文本，兼容思考模型和非思考模型。

    - 非思考模型: response.text 直接返回文本
    - 思考模型: response.text 为 None，需从 parts 中过滤掉 thought 部分提取文本
    """
    # 非思考模型直接走 response.text
    if response.text is not None:
        return response.text.strip()

    # 思考模型: 从 parts 中提取非 thought 文本
    if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
        texts = []
        for part in response.candidates[0].content.parts:
            if getattr(part, 'thought', False):
                continue
            if hasattr(part, 'text') and part.text:
                texts.append(part.text)
        if texts:
            return "\n".join(texts).strip()

    raise ValueError("Gemini 返回空文本（无有效内容）")


def rewrite_prompt(prompt_text: str, max_retries: int = 3, base_delay: float = 2) -> str:
    """调用 Gemini 执行文本重写，返回重写后的纯文本。

    Args:
        prompt_text: 发送给 Gemini 的完整指令文本（已由调用方组装好）
        max_retries: 最大尝试次数（含首次），默认 3
        base_delay:  首次重试基础延迟秒数，后续按 2^n 指数递增

    Returns:
        Gemini 返回的重写结果（已去除首尾空白和标点）

    Raises:
        Exception: 所有重试均失败后，抛出最后一次异常
    """
    client = create_client()
    model  = get_model()
    for attempt in range(1, max_retries + 1):
        try:
            resp = client.models.generate_content(model=model, contents=[prompt_text])
            return extract_response_text(resp).strip('，。, ')
        except Exception as e:
            if attempt < max_retries:
                delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
                logger.warning("rewrite_prompt 第%d次失败: %s，%.1fs 后重试...", attempt, e, delay)
                time.sleep(delay)
            else:
                logger.error("rewrite_prompt 重试%d次均失败: %s", max_retries, e)
                raise


def load_image_part(img_path: str) -> tuple:
    """
    加载图片文件并返回 (Part, None) 或 (None, error_message)。

    支持 PNG / JPEG / WebP 格式，其余格式默认按 image/png 处理。
    """
    if not img_path or not os.path.exists(img_path):
        return None, f"[图片不存在: {img_path}]"
    with open(img_path, 'rb') as f:
        data = f.read()
    mime = 'image/png'
    lp = img_path.lower()
    if lp.endswith(('.jpg', '.jpeg')):
        mime = 'image/jpeg'
    elif lp.endswith('.webp'):
        mime = 'image/webp'
    return types.Part.from_bytes(data=data, mime_type=mime), None

# ── 通用日志 ─────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)


def generate_content_with_retry(prompt, label="Gemini调用", max_retries=3, base_delay=2):
    """带指数退避重试的 Gemini generate_content 调用。

    Args:
        prompt:      发送给 Gemini 的完整提示文本
        label:       日志前缀，用于标识调用来源（如 "生成音色描述(文文)"）
        max_retries: 最大尝试次数（含首次），默认 3
        base_delay:  首次重试基础延迟秒数，后续按 2^n 指数递增

    Returns:
        Gemini 返回文本（已 strip）

    Raises:
        Exception: 所有重试均失败后，抛出最后一次异常
    """
    client = create_client()
    model = get_model()
    for attempt in range(1, max_retries + 1):
        try:
            response = client.models.generate_content(model=model, contents=[prompt])
            return extract_response_text(response)
        except Exception as e:
            if attempt < max_retries:
                delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
                logger.warning("%s 第%d次失败: %s，%.1fs 后重试...", label, attempt, e, delay)
                time.sleep(delay)
            else:
                logger.error("%s 重试%d次均失败: %s", label, max_retries, e)
                raise


if __name__ == '__main__':
    client = create_client()