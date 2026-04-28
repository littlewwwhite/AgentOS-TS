#!/usr/bin/env python3
"""Tests for the single-source storyboard contract module.

Covers each branch of validate_shot / validate_scene_shots / validate_storyboard
so the five existing call sites can be collapsed onto this module without
regressing behaviour.
"""
import unittest

from storyboard_contract import (
    DURATION_MAX,
    DURATION_MIN,
    SHOT_ID_RE,
    StoryboardContractError,
    validate_scene_shots,
    validate_shot,
    validate_storyboard,
)


def _shot(idx: int = 1, **overrides) -> dict:
    base = {
        "id": f"scn_001_clip{idx:03d}",
        "duration": 5,
        "prompt": "镜头提示词 with @act_001",
    }
    base.update(overrides)
    return base


class ValidateShotTest(unittest.TestCase):
    def test_accepts_minimal_shot(self) -> None:
        validate_shot(_shot(), "shot")

    def test_rejects_non_dict(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "must be an object"):
            validate_shot([], "shot")

    def test_rejects_bad_id(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "id must match"):
            validate_shot(_shot(id="clip_001"), "shot")

    def test_rejects_missing_id(self) -> None:
        bad = _shot()
        bad.pop("id")
        with self.assertRaisesRegex(StoryboardContractError, "id must match"):
            validate_shot(bad, "shot")

    def test_rejects_duration_below_range(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, r"\[4, 15\]"):
            validate_shot(_shot(duration=3), "shot")

    def test_rejects_duration_above_range(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, r"\[4, 15\]"):
            validate_shot(_shot(duration=16), "shot")

    def test_rejects_bool_as_duration(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "duration must be int"):
            validate_shot(_shot(duration=True), "shot")

    def test_rejects_blank_prompt(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "prompt must be"):
            validate_shot(_shot(prompt="   "), "shot")

    def test_ignores_extra_runtime_fields(self) -> None:
        validate_shot(_shot(lsi={"url": "https://x"}, first_frame_url="https://y"), "shot")


class ValidateSceneShotsTest(unittest.TestCase):
    def test_accepts_sequenced_shots(self) -> None:
        validate_scene_shots([_shot(1), _shot(2), _shot(3)], "scene")

    def test_rejects_empty_list(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "shots\\[\\] missing or empty"):
            validate_scene_shots([], "scene")

    def test_rejects_out_of_sequence_clip_numbers(self) -> None:
        shots = [_shot(1), _shot(3)]
        with self.assertRaisesRegex(StoryboardContractError, "out of sequence"):
            validate_scene_shots(shots, "scene")

    def test_propagates_shot_failure(self) -> None:
        shots = [_shot(1), _shot(2, duration=2)]
        with self.assertRaisesRegex(StoryboardContractError, r"\[4, 15\]"):
            validate_scene_shots(shots, "scene")


class ValidateStoryboardTest(unittest.TestCase):
    def test_accepts_minimal_document(self) -> None:
        data = {
            "episode_id": "ep001",
            "scenes": [{"scene_id": "scn_001", "shots": [_shot(1)]}],
        }
        validate_storyboard(data, "doc")

    def test_rejects_missing_scenes(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "scenes\\[\\] missing or empty"):
            validate_storyboard({"episode_id": "ep001"}, "doc")

    def test_rejects_blank_scene_id(self) -> None:
        data = {"episode_id": "ep001", "scenes": [{"scene_id": "  ", "shots": [_shot(1)]}]}
        with self.assertRaisesRegex(StoryboardContractError, "scene_id must"):
            validate_storyboard(data, "doc")


class ConstantsTest(unittest.TestCase):
    def test_duration_bounds(self) -> None:
        self.assertEqual(DURATION_MIN, 4)
        self.assertEqual(DURATION_MAX, 15)

    def test_shot_id_regex(self) -> None:
        self.assertIsNotNone(SHOT_ID_RE.match("scn_001_clip001"))
        self.assertIsNone(SHOT_ID_RE.match("scn_1_clip1"))


if __name__ == "__main__":
    unittest.main()
