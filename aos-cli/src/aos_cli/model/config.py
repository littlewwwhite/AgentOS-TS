# input: model request policy and process environment
# output: provider configuration dictionaries
# pos: environment-backed config resolver for model providers

import os

from aos_cli.model.errors import CONFIG_ERROR, ModelServiceError

DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com"
DEFAULT_GEMINI_TEXT_MODEL = "gemini-3-flash-preview"
DEFAULT_GEMINI_EMBED_MODEL = "gemini-embedding-001"
DEFAULT_OPENAI_BASE_URL = "https://api.chatfire.cn"
DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2"
DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_ARK_VIDEO_MODEL = "ep-20260303234827-tfnzm"


def resolve_gemini_config(request: dict) -> dict:
    return _resolve_provider_config(
        request,
        provider="gemini",
        api_key_env="GEMINI_API_KEY",
        base_url_env="GEMINI_BASE_URL",
        default_base_url=DEFAULT_GEMINI_BASE_URL,
        model_env="GEMINI_TEXT_MODEL",
        default_model=DEFAULT_GEMINI_TEXT_MODEL,
    )


def resolve_gemini_embedding_config(request: dict) -> dict:
    return _resolve_provider_config(
        request,
        provider="gemini",
        api_key_env="GEMINI_API_KEY",
        base_url_env="GEMINI_BASE_URL",
        default_base_url=DEFAULT_GEMINI_BASE_URL,
        model_env="GEMINI_EMBED_MODEL",
        default_model=DEFAULT_GEMINI_EMBED_MODEL,
    )


def resolve_openai_image_config(request: dict) -> dict:
    return _resolve_provider_config(
        request,
        provider="openai_compatible",
        api_key_env="OPENAI_API_KEY",
        base_url_env="OPENAI_BASE_URL",
        default_base_url=DEFAULT_OPENAI_BASE_URL,
        model_env="OPENAI_IMAGE_MODEL",
        default_model=DEFAULT_OPENAI_IMAGE_MODEL,
    )


def resolve_ark_video_config(request: dict) -> dict:
    return _resolve_provider_config(
        request,
        provider="ark",
        api_key_env="ARK_API_KEY",
        base_url_env="ARK_BASE_URL",
        default_base_url=DEFAULT_ARK_BASE_URL,
        model_env="ARK_VIDEO_MODEL",
        default_model=DEFAULT_ARK_VIDEO_MODEL,
    )


def _resolve_provider_config(
    request: dict,
    *,
    provider: str,
    api_key_env: str,
    base_url_env: str,
    default_base_url: str,
    model_env: str,
    default_model: str,
) -> dict:
    policy = request.get("modelPolicy") or {}
    api_key = os.environ.get(api_key_env, "")
    if not api_key:
        raise ModelServiceError(
            CONFIG_ERROR,
            f"{api_key_env} is not set",
            retryable=False,
            provider=provider,
        )
    return {
        "api_key": api_key,
        "base_url": os.environ.get(base_url_env, default_base_url),
        "model": policy.get("model") or os.environ.get(model_env, default_model),
    }
