from urllib.error import URLError

import pytest

from aos_cli.model.errors import PROVIDER_REJECTED, PROVIDER_TIMEOUT, ModelServiceError
from aos_cli.model.http import JsonHttpTransport


def test_json_http_transport_maps_url_timeout(monkeypatch):
    def raise_timeout(*args, **kwargs):
        raise URLError(TimeoutError("timed out"))

    monkeypatch.setattr("urllib.request.urlopen", raise_timeout)
    transport = JsonHttpTransport(provider="test", timeout_message="request timed out")

    with pytest.raises(ModelServiceError) as exc:
        transport.post_json("https://example.com", {}, {}, 1)

    assert exc.value.code == PROVIDER_TIMEOUT
    assert exc.value.retryable is True


def test_json_http_transport_maps_url_error(monkeypatch):
    def raise_url_error(*args, **kwargs):
        raise URLError("network unreachable")

    monkeypatch.setattr("urllib.request.urlopen", raise_url_error)
    transport = JsonHttpTransport(provider="test", timeout_message="request timed out")

    with pytest.raises(ModelServiceError) as exc:
        transport.post_json("https://example.com", {}, {}, 1)

    assert exc.value.code == PROVIDER_REJECTED
    assert exc.value.retryable is True
