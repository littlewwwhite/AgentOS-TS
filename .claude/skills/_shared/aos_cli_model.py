#!/usr/bin/env python3
# input: aos-cli model request paths and optional working directory
# output: subprocess.CompletedProcess from the repo-local aos-cli executable
# pos: shared skill-side adapter for deterministic model CLI calls

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable, Optional, Union

PathLike = Union[str, os.PathLike[str]]


def aos_cli_model_run(
    request_path: PathLike,
    response_path: PathLike,
    *,
    cwd: Optional[PathLike] = None,
) -> subprocess.CompletedProcess:
    return run_aos_cli(
        ["model", "run", "--input", str(request_path), "--output", str(response_path)],
        cwd=cwd,
    )


def aos_cli_model_submit(
    request_path: PathLike,
    task_path: PathLike,
    *,
    cwd: Optional[PathLike] = None,
) -> subprocess.CompletedProcess:
    return run_aos_cli(
        ["model", "submit", "--input", str(request_path), "--output", str(task_path)],
        cwd=cwd,
    )


def aos_cli_model_poll(
    task_path: PathLike,
    result_path: PathLike,
    *,
    cwd: Optional[PathLike] = None,
) -> subprocess.CompletedProcess:
    return run_aos_cli(
        ["model", "poll", "--input", str(task_path), "--output", str(result_path)],
        cwd=cwd,
    )


def aos_cli_model_validate(
    request_path: PathLike,
    *,
    cwd: Optional[PathLike] = None,
) -> subprocess.CompletedProcess:
    return run_aos_cli(["model", "validate", "--input", str(request_path)], cwd=cwd)


def run_aos_cli(
    args: Iterable[str],
    *,
    cwd: Optional[PathLike] = None,
) -> subprocess.CompletedProcess:
    working_dir = Path(cwd).resolve() if cwd is not None else Path.cwd().resolve()
    command = _aos_cli_command(working_dir)
    return subprocess.run(
        [*command, *args],
        cwd=working_dir,
        env=_aos_cli_env(working_dir),
        text=True,
        capture_output=True,
        check=False,
    )


def _aos_cli_command(start: Path) -> list[str]:
    try:
        repo_root = find_repo_root(start)
    except RuntimeError:
        if shutil.which("aos-cli"):
            return ["aos-cli"]
        raise

    return [sys.executable, "-m", "aos_cli.cli"]


def _aos_cli_env(start: Path) -> dict[str, str]:
    env = os.environ.copy()
    try:
        repo_root = find_repo_root(start)
    except RuntimeError:
        return env

    src_path = str(repo_root / "aos-cli" / "src")
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = src_path if not existing else os.pathsep.join([src_path, existing])
    return env


def find_repo_root(start: PathLike) -> Path:
    current = Path(start).resolve()
    if current.is_file():
        current = current.parent
    for directory in (current, *current.parents):
        if (directory / "aos-cli" / "pyproject.toml").is_file():
            return directory
    raise RuntimeError(f"Could not find repo root from {start}")
