# input: provider-independent image generation requests and OpenAI-compatible endpoint configuration
# output: normalized provider image result or stable model-service errors
# pos: OpenAI-compatible image provider adapter for aos-cli model service

from __future__ import annotations

from dataclasses import dataclass

from aos_cli.model.errors import PROVIDER_REJECTED, ModelServiceError
from aos_cli.model.http import JsonHttpTransport, map_http_error as map_provider_http_error


@dataclass(frozen=True)
class ProviderImageResult:
    urls: list[str]
    model: str
    usage: dict


def map_http_error(status_code: int, raw: str) -> ModelServiceError:
    return map_provider_http_error(provider="openai_compatible", status_code=status_code, raw=raw)


def extract_image_urls(payload: dict) -> list[str]:
    try:
        urls = [item["url"] for item in payload["data"] if item.get("url")]
    except (KeyError, TypeError) as exc:
        raise ModelServiceError(
            PROVIDER_REJECTED,
            "Image response missing data[].url",
            retryable=True,
            provider="openai_compatible",
        ) from exc
    if not urls:
        raise ModelServiceError(
            PROVIDER_REJECTED,
            "Image response contained no image URLs",
            retryable=True,
            provider="openai_compatible",
        )
    return urls


class UrllibTransport(JsonHttpTransport):
    def __init__(self) -> None:
        super().__init__(provider="openai_compatible", timeout_message="Image request timed out")


class OpenAIImageProvider:
    def __init__(self, api_key: str, base_url: str, model: str, transport=None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.transport = transport or UrllibTransport()

    def generate_image(self, *, prompt: str, options: dict) -> ProviderImageResult:
        body = {
            "model": self.model,
            "prompt": prompt,
            "n": int(options.get("n", 1)),
        }
        for field in ("size", "quality", "style"):
            if options.get(field):
                body[field] = options[field]
        payload = self.transport.post_json(
            f"{self.base_url}/v1/images/generations",
            body,
            headers={
                "authorization": f"Bearer {self.api_key}",
                "content-type": "application/json",
            },
            timeout=int(options.get("timeoutSeconds", 180)),
        )
        return ProviderImageResult(
            urls=extract_image_urls(payload),
            model=self.model,
            usage=payload.get("usage") or {},
        )
