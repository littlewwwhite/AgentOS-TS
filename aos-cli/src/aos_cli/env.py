# input: process environment, optional explicit env file path
# output: environment variables loaded for CLI provider configuration
# pos: startup configuration adapter for project-scoped aos-cli runs

from __future__ import annotations

import os
from pathlib import Path


def load_project_env(env_file: Path | None = None) -> Path | None:
    """Load a single .env file into os.environ without overriding existing keys.

    If env_file is given and exists, it is loaded. Otherwise, ``cwd/.env`` is
    loaded if present. No ancestor walk. Existing environment variables always
    win over file-supplied values.
    """

    if env_file is not None:
        if env_file.is_file():
            load_env_file(env_file)
            return env_file
        return None
    candidate = Path.cwd() / ".env"
    if candidate.is_file():
        load_env_file(candidate)
        return candidate
    return None


def load_env_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        parsed = parse_env_line(raw_line)
        if parsed is None:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].lstrip()
    if "=" not in stripped:
        return None

    key, value = stripped.split("=", 1)
    key = key.strip()
    if not key or not key.replace("_", "").isalnum() or key[0].isdigit():
        return None

    return key, _parse_env_value(value.strip())


def _parse_env_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        quote = value[0]
        value = value[1:-1]
        if quote == '"':
            return value.encode("utf-8").decode("unicode_escape")
        return value
    return _strip_inline_comment(value).strip()


def _strip_inline_comment(value: str) -> str:
    in_single = False
    in_double = False
    for index, char in enumerate(value):
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif char == "#" and not in_single and not in_double:
            if index == 0 or value[index - 1].isspace():
                return value[:index]
    return value
