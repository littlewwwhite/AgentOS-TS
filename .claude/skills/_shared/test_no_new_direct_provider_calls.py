# input: migrated skill script source files
# output: guardrail tests preventing direct provider SDK/API reintroduction
# pos: migration safety net for the aos-cli model boundary

from __future__ import annotations

import ast
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]

MIGRATED_SCRIPT_PATHS = [
    ".claude/skills/storyboard/scripts/storyboard_batch.py",
    ".claude/skills/asset-gen/scripts/common_gemini_client.py",
    ".claude/skills/asset-gen/scripts/common_vision_review.py",
    ".claude/skills/asset-gen/scripts/generate_prompts_from_script.py",
    ".claude/skills/asset-gen/scripts/style_generate.py",
    ".claude/skills/asset-gen/scripts/common_image_api.py",
    ".claude/skills/asset-gen/scripts/review_scene.py",
    ".claude/skills/asset-gen/scripts/review_char.py",
    ".claude/skills/asset-gen/scripts/review_props.py",
    ".claude/skills/video-editing/scripts/common_video_analyze.py",
    ".claude/skills/video-editing/scripts/phase1_analyze.py",
    ".claude/skills/video-editing/scripts/phase2_assemble.py",
    ".claude/skills/music-matcher/scripts/analyze_video.py",
    ".claude/skills/music-matcher/scripts/batch_analyze.py",
    ".claude/skills/subtitle-maker/scripts/common_audio_transcribe.py",
    ".claude/skills/subtitle-maker/scripts/phase0_check.py",
    ".claude/skills/subtitle-maker/scripts/phase2_transcribe.py",
    ".claude/skills/video-gen/scripts/analyzer.py",
    ".claude/skills/video-gen/scripts/video_api.py",
]

FORBIDDEN_IMPORT_PREFIXES = (
    "google",
    "openai",
)

FORBIDDEN_TEXT_SNIPPETS = (
    "generate_content(",
    "/v1/images/generations",
    "ARK_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
)

DEFERRED_MULTIMODAL_PATHS = [
    ".claude/skills/video-gen/scripts/frame_extractor.py",
    ".claude/skills/video-gen/scripts/config_loader.py",
    ".claude/skills/video-gen/assets/config.json",
]

DEFERRED_MARKER = "Model boundary note: deferred multimodal"


def _matches_prefix(name: str, prefixes: tuple[str, ...]) -> bool:
    return any(name == prefix or name.startswith(f"{prefix}.") for prefix in prefixes)


class DirectProviderGuardrailTests(unittest.TestCase):
    def test_migrated_scripts_do_not_import_provider_sdks(self) -> None:
        violations: list[str] = []
        for relative_path in MIGRATED_SCRIPT_PATHS:
            path = REPO_ROOT / relative_path
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if _matches_prefix(alias.name, FORBIDDEN_IMPORT_PREFIXES):
                            violations.append(f"{relative_path}: import {alias.name}")
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    if _matches_prefix(module, FORBIDDEN_IMPORT_PREFIXES):
                        violations.append(f"{relative_path}: from {module} import ...")

        self.assertEqual(violations, [])

    def test_migrated_scripts_do_not_reference_raw_provider_contracts(self) -> None:
        violations: list[str] = []
        for relative_path in MIGRATED_SCRIPT_PATHS:
            source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
            for snippet in FORBIDDEN_TEXT_SNIPPETS:
                if snippet in source:
                    violations.append(f"{relative_path}: {snippet}")

        self.assertEqual(violations, [])

    def test_deferred_paths_carry_boundary_note(self) -> None:
        violations: list[str] = []
        for relative_path in DEFERRED_MULTIMODAL_PATHS:
            path = REPO_ROOT / relative_path
            if not path.exists():
                violations.append(f"{relative_path}: missing")
                continue
            text = path.read_text(encoding="utf-8")
            if DEFERRED_MARKER not in text:
                violations.append(f"{relative_path}: missing '{DEFERRED_MARKER}'")
        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
