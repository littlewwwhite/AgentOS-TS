# input: provider HTTP request parameters and provider identity
# output: JSON payloads or normalized model-service errors
# pos: shared JSON-over-HTTP transport for model providers

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request

from aos_cli.model.errors import AUTH_ERROR, PROVIDER_REJECTED, PROVIDER_TIMEOUT, RATE_LIMITED, ModelServiceError


def map_http_error(*, provider: str, status_code: int, raw: str) -> ModelServiceError:
    if status_code in {401, 403}:
        return ModelServiceError(
            AUTH_ERROR,
            raw,
            retryable=False,
            provider=provider,
            status_code=status_code,
        )
    if status_code in {402, 429}:
        return ModelServiceError(
            RATE_LIMITED,
            raw,
            retryable=True,
            provider=provider,
            status_code=status_code,
        )
    return ModelServiceError(
        PROVIDER_REJECTED,
        raw,
        retryable=status_code >= 500,
        provider=provider,
        status_code=status_code,
    )


class JsonHttpTransport:
    def __init__(self, *, provider: str, timeout_message: str, bad_json_message: str = "Provider returned non-JSON") -> None:
        self.provider = provider
        self.timeout_message = timeout_message
        self.bad_json_message = bad_json_message

    def post_json(self, url: str, body: dict, headers: dict, timeout: int) -> dict:
        return self.request_json(url=url, body=body, headers=headers, timeout=timeout, method="POST")

    def get_json(self, url: str, headers: dict, timeout: int) -> dict:
        return self.request_json(url=url, body=None, headers=headers, timeout=timeout, method="GET")

    def request_json(self, *, url: str, body: dict | None, headers: dict, timeout: int, method: str) -> dict:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content_type = response.headers.get("content-type", "")
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise map_http_error(provider=self.provider, status_code=exc.code, raw=raw) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ModelServiceError(
                PROVIDER_TIMEOUT,
                self.timeout_message,
                retryable=True,
                provider=self.provider,
            ) from exc
        except urllib.error.URLError as exc:
            reason = exc.reason
            if isinstance(reason, (TimeoutError, socket.timeout)):
                raise ModelServiceError(
                    "PROVIDER_TIMEOUT",
                    self.timeout_message,
                    retryable=True,
                    provider=self.provider,
                ) from exc
            raise ModelServiceError(
                PROVIDER_REJECTED,
                str(reason),
                retryable=True,
                provider=self.provider,
            ) from exc

        if "html" in content_type.lower() or raw.lstrip().startswith("<"):
            raise ModelServiceError(
                PROVIDER_REJECTED,
                "Provider returned HTML",
                retryable=True,
                provider=self.provider,
            )

        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ModelServiceError(
                PROVIDER_REJECTED,
                self.bad_json_message,
                retryable=True,
                provider=self.provider,
            ) from exc
