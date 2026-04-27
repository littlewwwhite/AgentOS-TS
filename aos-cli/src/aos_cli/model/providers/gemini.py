# input: provider-independent text generation requests and Gemini endpoint configuration
# output: normalized provider text result or stable model-service errors
# pos: Gemini-compatible provider adapter for aos-cli model service

from __future__ import annotations

import base64
from dataclasses import dataclass
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from aos_cli.model.errors import PROVIDER_REJECTED, INVALID_REQUEST, ModelServiceError
from aos_cli.model.http import JsonHttpTransport, map_http_error as map_provider_http_error
from aos_cli.model.media import infer_mime_type


@dataclass(frozen=True)
class ProviderTextResult:
    text: str
    model: str
    usage: dict


@dataclass(frozen=True)
class ProviderEmbeddingResult:
    values: list[float]
    model: str
    usage: dict


def map_http_error(status_code: int, raw: str) -> ModelServiceError:
    return map_provider_http_error(provider="gemini", status_code=status_code, raw=raw)


def extract_text(payload: dict) -> str:
    try:
        return payload["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelServiceError(
            PROVIDER_REJECTED,
            "Gemini response missing candidates[0].content.parts[0].text",
            retryable=True,
            provider="gemini",
        ) from exc


def extract_usage(payload: dict) -> dict:
    usage = payload.get("usageMetadata") or {}
    return {
        "inputTokens": usage.get("promptTokenCount", 0),
        "outputTokens": usage.get("candidatesTokenCount", 0),
    }


def extract_embedding_values(payload: dict) -> list[float]:
    try:
        values = payload["embedding"]["values"]
    except (KeyError, TypeError) as exc:
        embeddings = payload.get("embeddings")
        if isinstance(embeddings, list) and embeddings:
            values = embeddings[0].get("values")
        else:
            raise ModelServiceError(
                PROVIDER_REJECTED,
                "Gemini embedding response missing embedding.values",
                retryable=True,
                provider="gemini",
            ) from exc
    if not isinstance(values, list):
        raise ModelServiceError(
            PROVIDER_REJECTED,
            "Gemini embedding values must be a list",
            retryable=True,
            provider="gemini",
        )
    return [float(value) for value in values]


class UrllibTransport(JsonHttpTransport):
    def __init__(self) -> None:
        super().__init__(provider="gemini", timeout_message="Gemini request timed out")


class GeminiProvider:
    def __init__(self, api_key: str, base_url: str, model: str, transport=None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.transport = transport or UrllibTransport()

    def generate_text(
        self,
        *,
        system: str | None,
        content: object,
        options: dict,
    ) -> ProviderTextResult:
        body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": _content_to_text(content)}],
                }
            ],
            "generationConfig": {
                "temperature": options.get("temperature", 0.6),
                "maxOutputTokens": options.get("maxOutputTokens", 2000),
            },
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if options.get("responseMimeType"):
            body["generationConfig"]["responseMimeType"] = options["responseMimeType"]
        if options.get("responseJsonSchema"):
            body["generationConfig"]["responseJsonSchema"] = options["responseJsonSchema"]

        payload = self.transport.post_json(
            f"{self.base_url}/v1beta/models/{self.model}:generateContent",
            body,
            headers={
                "x-goog-api-key": self.api_key,
                "content-type": "application/json",
            },
            timeout=int(options.get("timeoutSeconds", 180)),
        )
        return ProviderTextResult(
            text=extract_text(payload),
            model=self.model,
            usage=extract_usage(payload),
        )

    def generate_multimodal(
        self,
        *,
        system: str | None,
        content: object,
        options: dict,
    ) -> ProviderTextResult:
        body = {
            "contents": [
                {
                    "role": "user",
                    "parts": _content_to_parts(content),
                }
            ],
            "generationConfig": {
                "temperature": options.get("temperature", 0.2),
                "maxOutputTokens": options.get("maxOutputTokens", 2000),
            },
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if options.get("responseMimeType"):
            body["generationConfig"]["responseMimeType"] = options["responseMimeType"]
        if options.get("responseJsonSchema"):
            body["generationConfig"]["responseJsonSchema"] = options["responseJsonSchema"]

        payload = self.transport.post_json(
            f"{self.base_url}/v1beta/models/{self.model}:generateContent",
            body,
            headers={
                "x-goog-api-key": self.api_key,
                "content-type": "application/json",
            },
            timeout=int(options.get("timeoutSeconds", 180)),
        )
        return ProviderTextResult(
            text=extract_text(payload),
            model=self.model,
            usage=extract_usage(payload),
        )

    def embed_content(self, *, content: object, options: dict) -> ProviderEmbeddingResult:
        body = {
            "model": f"models/{self.model}",
            "content": {"parts": [{"text": _content_to_text(content)}]},
        }
        if options.get("taskType"):
            body["task_type"] = options["taskType"]
        if options.get("outputDimensionality"):
            body["output_dimensionality"] = int(options["outputDimensionality"])
        payload = self.transport.post_json(
            f"{self.base_url}/v1beta/models/{self.model}:embedContent",
            body,
            headers={
                "x-goog-api-key": self.api_key,
                "content-type": "application/json",
            },
            timeout=int(options.get("timeoutSeconds", 180)),
        )
        return ProviderEmbeddingResult(
            values=extract_embedding_values(payload),
            model=self.model,
            usage=extract_usage(payload),
        )


def _content_to_text(content: object) -> str:
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=False)


def _content_to_parts(content: object) -> list[dict]:
    if not isinstance(content, dict):
        return [{"text": _content_to_text(content)}]
    prompt = str(content.get("prompt") or content.get("text") or "")
    parts = [{"text": prompt}] if prompt else []
    for uri in content.get("images") or []:
        parts.append(_uri_part(uri, default_mime_type="image/png"))
    for uri in content.get("videos") or []:
        parts.append(_uri_part(uri, default_mime_type="video/mp4"))
    if content.get("audio"):
        parts.append(_uri_part(content["audio"], default_mime_type="audio/mpeg"))
    return parts or [{"text": _content_to_text(content)}]


def _uri_part(uri: str, *, default_mime_type: str) -> dict:
    parsed = urlparse(uri)
    mime_type = _mime_type_from_uri(uri, default_mime_type)
    if parsed.scheme == "file":
        path = Path(unquote(parsed.path))
        try:
            if path.stat().st_size > 20 * 1024 * 1024:
                raise ModelServiceError(
                    INVALID_REQUEST,
                    "Local media file is too large for inline Gemini upload",
                    retryable=False,
                    provider="gemini",
                )
            data = path.read_bytes()
        except ModelServiceError:
            raise
        except OSError as exc:
            raise ModelServiceError(
                INVALID_REQUEST,
                f"Local media file is not readable: {path}",
                retryable=False,
                provider="gemini",
            ) from exc
        return {
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(data).decode("ascii"),
            }
        }
    return {"file_data": {"mime_type": mime_type, "file_uri": uri}}


def _mime_type_from_uri(uri: str, default_mime_type: str) -> str:
    return infer_mime_type(uri, default_mime_type)
