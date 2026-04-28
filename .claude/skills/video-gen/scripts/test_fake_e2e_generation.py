# input: video-gen batch entrypoint and aos-cli fake video provider
# output: regression assertions for episode 1-3 fake E2E artifacts and duration evidence
# pos: fake E2E coverage for VIDEO generation deliverables

import json
import os
from pathlib import Path


def _write_storyboard(project: Path, episode: int, durations: list[int]) -> Path:
    approved_dir = project / "output" / "storyboard" / "approved"
    approved_dir.mkdir(parents=True, exist_ok=True)
    storyboard_path = approved_dir / f"ep{episode:03d}_storyboard.json"
    shots = [
        {
            "id": f"scn_001_clip{index:03d}",
            "duration": duration,
            "prompt": f"Episode {episode} shot {index} advances the scene.",
        }
        for index, duration in enumerate(durations, start=1)
    ]
    storyboard_path.write_text(
        json.dumps(
            {
                "episode_id": f"ep_{episode:03d}",
                "title": f"Fake Episode {episode}",
                "scenes": [
                    {
                        "scene_id": "scn_001",
                        "actors": [],
                        "locations": [],
                        "props": [],
                        "shots": shots,
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return storyboard_path


def test_fake_e2e_generates_episode_1_to_3_artifacts_with_duration_evidence(
    tmp_path,
    monkeypatch,
):
    import batch_generate

    project = tmp_path / "project"
    monkeypatch.setenv("PROJECT_DIR", str(project))
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    monkeypatch.setenv(
        "AOS_CLI_MODEL_FAKE_ARTIFACT_DIR",
        str(tmp_path / "fake-video-artifacts"),
    )

    requested_durations = {
        1: [6, 8],
        2: [7, 10],
        3: [9, 12],
    }

    for episode, durations in requested_durations.items():
        storyboard_path = _write_storyboard(project, episode, durations)
        output_root = project / "output" / f"ep{episode:03d}"

        results = batch_generate.run_batch_generate(
            str(storyboard_path),
            str(output_root),
            episode,
            poll_interval=0,
            timeout=1,
            skip_review=True,
        )

        assert len(results) == len(durations)
        summary_path = (
            project
            / "workspace"
            / f"ep{episode:03d}"
            / f"ep{episode:03d}_generation_summary.json"
        )
        delivery_path = output_root / f"ep{episode:03d}_delivery.json"
        task_manifest_path = output_root / f"ep{episode:03d}_video_task_manifest.json"
        runtime_storyboard_path = output_root / f"ep{episode:03d}_storyboard.json"

        assert runtime_storyboard_path.is_file()
        assert delivery_path.is_file()
        assert task_manifest_path.is_file()
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        task_manifest = json.loads(task_manifest_path.read_text(encoding="utf-8"))
        assert summary["episode"] == episode
        assert summary["success"] == len(durations)
        assert summary["failed"] == 0
        assert summary["runtime_storyboard_json"] == str(runtime_storyboard_path)
        assert summary["video_task_manifest_json"] == str(task_manifest_path)
        assert task_manifest["episode"] == episode
        assert task_manifest["runtime_storyboard_json"] == str(runtime_storyboard_path)
        assert len(task_manifest["tasks"]) == len(durations)

        evidence = []
        manifest_evidence = []
        for result in summary["results"]:
            assert result["success"] is True
            version = result["versions"][0]
            output_path = Path(version["output_path"])
            assert output_path.is_file()
            evidence.append(
                (
                    version["requested_duration_seconds"],
                    version["actual_duration_seconds"],
                )
            )

        for task in task_manifest["tasks"]:
            assert task["episode"] == episode
            assert task["scene_id"] == "scn_001"
            assert task["clip_id"].startswith("scn001_clip")
            assert task["shot_id"] == task["clip_id"]
            assert task["provider_task_id"]
            output_path = Path(task["output_path"])
            assert output_path.is_file()
            manifest_evidence.append(
                (
                    task["requested_duration_seconds"],
                    task["actual_duration_seconds"],
                )
            )

        assert evidence == [(duration, float(duration)) for duration in durations]
        assert manifest_evidence == [(duration, float(duration)) for duration in durations]
        assert all(actual != 5.0 for _requested, actual in evidence)
