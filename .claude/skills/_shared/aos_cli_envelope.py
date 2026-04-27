# input: aos-cli model request dicts and a working directory
# output: parsed aos-cli response envelopes plus typed extractors
# pos: shared envelope helper that absorbs the tempfile/subprocess/validation boilerplate

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Iterable

from aos_cli_model import (
    aos_cli_model_poll,
    aos_cli_model_run,
    aos_cli_model_submit,
)


def run_envelope(
    request: dict[str, Any],
    *,
    cwd: Path | str,
    expected_kind: str | None = None,
    tmp_prefix: str = "aos-cli-",
    validate_ok: bool = True,
) -> dict[str, Any]:
    """Submit a synchronous aos-cli model request and return the response envelope.

    Validates `ok=True` and (optionally) `output.kind == expected_kind`. Raises
    RuntimeError on protocol violations; the caller decides whether to retry.
    Set `validate_ok=False` when the caller needs to inspect `error.code` to
    map specific failure modes (e.g., quota / auth) to typed exceptions.
    """
    return _dispatch(
        request,
        cwd=cwd,
        mode="run",
        tmp_prefix=tmp_prefix,
        expected_kind=expected_kind,
        validate_ok=validate_ok,
    )


def submit_envelope(
    request: dict[str, Any],
    *,
    cwd: Path | str,
    tmp_prefix: str = "aos-cli-submit-",
) -> dict[str, Any]:
    """Submit an async aos-cli task request and return the task envelope."""
    return _dispatch(request, cwd=cwd, mode="submit", tmp_prefix=tmp_prefix, expected_kind="task")


def poll_envelope(
    task_envelope: dict[str, Any],
    *,
    cwd: Path | str,
    tmp_prefix: str = "aos-cli-poll-",
) -> dict[str, Any]:
    """Poll an aos-cli task envelope and return the latest result envelope."""
    return _dispatch(task_envelope, cwd=cwd, mode="poll", tmp_prefix=tmp_prefix, expected_kind=None)


def extract_text(envelope: dict[str, Any]) -> str:
    output = envelope.get("output") or {}
    text = output.get("text")
    if isinstance(text, str) and text:
        return text.strip()
    raise RuntimeError("aos-cli response missing output.text")


def extract_json(envelope: dict[str, Any]) -> Any:
    output = envelope.get("output") or {}
    if "data" in output and output["data"] is not None:
        return output["data"]
    text = output.get("text")
    if isinstance(text, str) and text:
        return _parse_json_text(text)
    raise RuntimeError("aos-cli response missing output.data")


def extract_artifacts(envelope: dict[str, Any]) -> list[dict[str, Any]]:
    output = envelope.get("output") or {}
    artifacts = output.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise RuntimeError("aos-cli response missing output.artifacts")
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise RuntimeError(f"aos-cli artifact must be an object: {artifact}")
    return artifacts


def _dispatch(
    payload: dict[str, Any],
    *,
    cwd: Path | str,
    mode: str,
    tmp_prefix: str,
    expected_kind: str | None,
    validate_ok: bool = True,
) -> dict[str, Any]:
    working_dir = Path(cwd).resolve() if cwd else Path.cwd().resolve()
    with tempfile.TemporaryDirectory(prefix=tmp_prefix) as tmp:
        tmp_dir = Path(tmp)
        request_path = tmp_dir / "request.json"
        response_path = tmp_dir / "response.json"
        request_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        if mode == "run":
            completed = aos_cli_model_run(request_path, response_path, cwd=working_dir)
        elif mode == "submit":
            completed = aos_cli_model_submit(request_path, response_path, cwd=working_dir)
        elif mode == "poll":
            completed = aos_cli_model_poll(request_path, response_path, cwd=working_dir)
        else:
            raise ValueError(f"Unknown aos-cli envelope mode: {mode}")

        if completed.returncode != 0 and not response_path.exists():
            raise RuntimeError(completed.stderr or f"aos-cli exited with {completed.returncode}")
        if not response_path.exists():
            raise RuntimeError("aos-cli did not write a response envelope")
        envelope = _read_envelope(response_path)

    if validate_ok and not envelope.get("ok"):
        error = envelope.get("error") or {}
        raise RuntimeError(error.get("message") or f"aos-cli {mode} failed")

    if expected_kind is not None and envelope.get("ok"):
        actual_kind = (envelope.get("output") or {}).get("kind")
        if actual_kind != expected_kind:
            raise RuntimeError(
                f"aos-cli output.kind mismatch: expected {expected_kind}, got {actual_kind}"
            )
    return envelope


def _read_envelope(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli response envelope: {path}") from exc


def _parse_json_text(raw: str) -> Any:
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(text)


__all__ = [
    "run_envelope",
    "submit_envelope",
    "poll_envelope",
    "extract_text",
    "extract_json",
    "extract_artifacts",
]
