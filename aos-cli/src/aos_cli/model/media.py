# input: media URI-like strings
# output: inferred MIME types
# pos: shared media metadata helpers for providers and artifact descriptors

from pathlib import Path
from urllib.parse import urlparse

MIME_TYPES_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
}


def infer_mime_type(value: str, default: str) -> str:
    suffix = Path(urlparse(value).path).suffix.lower()
    return MIME_TYPES_BY_SUFFIX.get(suffix, default)
