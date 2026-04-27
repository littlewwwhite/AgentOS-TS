#!/usr/bin/env python3
# input: video-gen runtime generation loop with fake submit/poll functions
# output: regression assertions for duration evidence recorded in clip results
# pos: duration manifest regression coverage for VIDEO generation

from pathlib import Path


class FakePaths:
    def __init__(self, root: Path) -> None:
        self.root = root

    def get_video_path(self, episode, location_num, clip_num, version):
        return self.root / f"ep{episode:03d}_loc{location_num:03d}_clip{clip_num:03d}_v{version:03d}.mp4"

    def init_clip_dir(self, episode, location_num, clip_num):
        self.root.mkdir(parents=True, exist_ok=True)


def test_generation_result_records_requested_and_actual_duration(tmp_path, monkeypatch):
    import batch_generate_runtime as runtime

    submitted_durations = []

    def fake_submit_video(**kwargs):
        submitted_durations.append(kwargs["duration"])
        return {
            "success": True,
            "task_id": "task-duration-1",
            "provider": "ark",
            "model_code": "fake-model",
            "task_envelope": {"output": {"taskId": "task-duration-1"}},
        }

    def fake_poll_multiple_tasks(tasks, interval, timeout):
        return [
            {
                "success": True,
                "task_id": tasks[0]["task_id"],
                "output_path": tasks[0]["output_path"],
                "video_path": str(tmp_path / "clip.mp4"),
                "video_url": "https://example.test/clip.mp4",
                "last_frame_url": "https://example.test/last.png",
                "actual_duration_seconds": 9.0,
            }
        ]

    monkeypatch.setattr(runtime, "submit_video", fake_submit_video)
    monkeypatch.setattr(runtime, "poll_multiple_tasks", fake_poll_multiple_tasks)
    monkeypatch.setattr(runtime, "precheck_and_fix", lambda prompt, clip_id: (True, prompt, []))

    clip = {
        "ls": {"full_prompts": "slow push in"},
        "ls_id": "scn001_clip001",
        "scene_id": "scn_001",
        "prompt_version": 0,
        "subjects": [],
        "reference_images": [],
        "prompt": "slow push in",
        "dur_api": 9,
        "location_num": 1,
        "clip_num": 1,
        "attempts": 0,
        "passed": False,
        "done": False,
        "versions": [],
        "best_version": None,
    }

    runtime._run_generation_rounds(
        clip_group=[clip],
        episode=1,
        paths=FakePaths(tmp_path),
        model_code="fake-model",
        quality="720",
        ratio="16:9",
        poll_interval=0,
        timeout=1,
        gemini_api_key=None,
        skip_review=True,
    )

    assert submitted_durations == ["9"]
    version = clip["versions"][0]
    assert version["requested_duration_seconds"] == 9
    assert version["actual_duration_seconds"] == 9.0
    assert version["provider_task_id"] == "task-duration-1"
    assert version["output_path"] == str(tmp_path / "clip.mp4")
