# input: skills source tree
# output: guardrail tests preventing direct provider SDK reintroduction
# pos: structural ban on provider SDK imports inside skills

from __future__ import annotations

import ast
from pathlib import Path
from typing import Iterator
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_ROOT = REPO_ROOT / ".claude" / "skills"

FORBIDDEN_IMPORT_PREFIXES = ("google", "openai", "volcenginesdkarkruntime")

DEFERRED_MARKER = "Model boundary note: " + "deferred multimodal"
LEGACY_GEMINI_ADAPTER = SKILLS_ROOT / "video-gen" / "scripts" / "gemini_adapter.py"


def _matches_prefix(name: str, prefixes: tuple[str, ...]) -> bool:
    return any(name == prefix or name.startswith(f"{prefix}.") for prefix in prefixes)


def _python_sources(root: Path) -> Iterator[Path]:
    for path in root.rglob("*.py"):
        if any(part == "__pycache__" for part in path.parts):
            continue
        yield path


class DirectProviderGuardrailTests(unittest.TestCase):
    def test_skills_do_not_import_provider_sdks(self) -> None:
        violations: list[str] = []
        for path in _python_sources(SKILLS_ROOT):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            relative = path.relative_to(REPO_ROOT)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if _matches_prefix(alias.name, FORBIDDEN_IMPORT_PREFIXES):
                            violations.append(f"{relative}: import {alias.name}")
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    if _matches_prefix(module, FORBIDDEN_IMPORT_PREFIXES):
                        violations.append(f"{relative}: from {module} import ...")
        self.assertEqual(violations, [])

    def test_no_deferred_multimodal_paths_remain_in_skills(self) -> None:
        violations: list[str] = []
        for path in SKILLS_ROOT.rglob("*"):
            if not path.is_file() or any(part == "__pycache__" for part in path.parts):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if DEFERRED_MARKER in text:
                violations.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(violations, [])

    def test_legacy_gemini_adapter_does_not_exist(self) -> None:
        self.assertFalse(LEGACY_GEMINI_ADAPTER.exists())


if __name__ == "__main__":
    unittest.main()
