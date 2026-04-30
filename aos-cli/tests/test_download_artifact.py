import io
import os
import urllib.request
from pathlib import Path

from aos_cli.model.service import _download_artifact


class _FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self._buf = io.BytesIO(payload)
        self.fp = self._buf

    def read(self, size: int = -1) -> bytes:
        return self._buf.read(size)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self._buf.close()
        return False


def test_download_artifact_path_is_pid_isolated(tmp_path: Path, monkeypatch):
    payload = b"hello-bytes"
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda url, timeout=None: _FakeResponse(payload),
    )
    path, sha, byte_count = _download_artifact("https://x.test/foo.mp4", tmp_path, 0)
    assert path.name == f"artifact-{os.getpid()}-1.mp4"
    assert byte_count == len(payload)
    assert path.read_bytes() == payload
    assert len(sha) == 64


def test_download_artifact_distinct_pids_do_not_collide(tmp_path: Path, monkeypatch):
    payload = b"data"
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda url, timeout=None: _FakeResponse(payload),
    )

    real_pid = os.getpid()
    p1, _, _ = _download_artifact("https://x.test/a.png", tmp_path, 0)

    monkeypatch.setattr(os, "getpid", lambda: real_pid + 1)
    p2, _, _ = _download_artifact("https://x.test/a.png", tmp_path, 0)

    assert p1 != p2
    assert p1.exists() and p2.exists()
