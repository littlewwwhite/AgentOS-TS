# input: local artifact paths and provider metadata
# output: stable artifact descriptors
# pos: artifact reporting boundary for model capability outputs

import hashlib
from pathlib import Path

CHUNK_SIZE = 1024 * 1024


def build_remote_artifact_descriptor(
    *,
    uri: str,
    kind: str,
    mime_type: str,
    role: str | None = None,
    remote_url: str | None = None,
) -> dict:
    descriptor = {
        "kind": kind,
        "uri": uri,
        "mimeType": mime_type,
    }
    if role:
        descriptor["role"] = role
    if remote_url:
        descriptor["remoteUrl"] = remote_url
    return descriptor


def build_artifact_descriptor(
    *,
    path: Path,
    kind: str,
    mime_type: str,
    role: str | None = None,
    remote_url: str | None = None,
    sha256: str | None = None,
    byte_count: int | None = None,
) -> dict:
    if sha256 is None or byte_count is None:
        sha256, byte_count = hash_file(path)
    descriptor = {
        "kind": kind,
        "uri": path.resolve().as_uri(),
        "mimeType": mime_type,
        "sha256": sha256,
        "bytes": byte_count,
    }
    if role:
        descriptor["role"] = role
    if remote_url:
        descriptor["remoteUrl"] = remote_url
    return descriptor


def hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_count = 0
    with path.open("rb") as file:
        while chunk := file.read(CHUNK_SIZE):
            digest.update(chunk)
            byte_count += len(chunk)
    return digest.hexdigest(), byte_count
