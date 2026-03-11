#!/usr/bin/env python3
# input: --source-path pointing to a source text file
# output: JSON with projectName, projectPath, originalSourcePath, sourceTextPath
# pos: CLI entry point for preparing a source project workspace

import json
import sys
import argparse
import shutil
from pathlib import Path


def get_workspace_root(source_path: Path) -> Path:
    # Convention: if file is inside a "data/" dir, workspace root is data's parent
    parent = source_path.parent
    return parent.parent if parent.name == "data" else parent


def prepare_source_project(source_path: str) -> dict:
    resolved = Path(source_path).resolve()
    if not resolved.is_file():
        raise ValueError(f"Source path is not a file: {resolved}")

    project_name = resolved.stem
    workspace_root = get_workspace_root(resolved)
    project_path = workspace_root / project_name
    source_text_path = project_path / "source.txt"

    project_path.mkdir(parents=True, exist_ok=True)
    shutil.copy2(resolved, source_text_path)

    return {
        "projectName": project_name,
        "projectPath": str(project_path),
        "originalSourcePath": str(resolved),
        "sourceTextPath": str(source_text_path),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare a source project workspace")
    parser.add_argument("--source-path", required=True, help="Path to the source text file")
    args = parser.parse_args()

    try:
        result = prepare_source_project(args.source_path)
        print(json.dumps(result))
    except FileNotFoundError as e:
        print(json.dumps({"error": f"File not found: {e}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
