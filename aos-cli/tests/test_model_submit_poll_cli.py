import json
from pathlib import Path
import shutil
import subprocess

from aos_cli.cli import main


def test_model_submit_writes_task_file(tmp_path, monkeypatch):
    request_path = tmp_path / "submit.json"
    task_path = tmp_path / "task.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "video.clip",
                "capability": "video.generate",
                "output": {"kind": "task"},
                "input": {"prompt": "move"},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "submit", "--input", str(request_path), "--output", str(task_path)])

    assert code == 0
    payload = json.loads(task_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "task"
    assert payload["output"]["taskId"].startswith("fake-video-task-")


def test_model_fake_submit_uses_distinct_task_ids_for_distinct_video_requests(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    request_one = tmp_path / "submit-one.json"
    request_two = tmp_path / "submit-two.json"
    task_one = tmp_path / "task-one.json"
    task_two = tmp_path / "task-two.json"
    base = {
        "apiVersion": "aos-cli.model/v1",
        "task": "video.generate",
        "capability": "video.generate",
        "output": {"kind": "task"},
    }
    request_one.write_text(
        json.dumps({**base, "input": {"prompt": "scene one", "duration": 6}}),
        encoding="utf-8",
    )
    request_two.write_text(
        json.dumps({**base, "input": {"prompt": "scene two", "duration": 7}}),
        encoding="utf-8",
    )

    assert main(["model", "submit", "--input", str(request_one), "--output", str(task_one)]) == 0
    assert main(["model", "submit", "--input", str(request_two), "--output", str(task_two)]) == 0
    first = json.loads(task_one.read_text(encoding="utf-8"))["output"]["taskId"]
    second = json.loads(task_two.read_text(encoding="utf-8"))["output"]["taskId"]
    assert first.startswith("fake-video-task-")
    assert second.startswith("fake-video-task-")
    assert first != second


def test_model_poll_writes_task_result_file(tmp_path, monkeypatch):
    task_path = tmp_path / "task.json"
    result_path = tmp_path / "result.json"
    task_path.write_text(
        json.dumps(
            {
                "ok": True,
                "apiVersion": "aos-cli.model/v1",
                "task": "video.clip",
                "capability": "video.generate",
                "output": {"kind": "task", "taskId": "fake-video-task"},
                "provider": "ark",
                "model": "fake-video-model",
                "usage": {},
                "latencyMs": 1,
                "warnings": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "poll", "--input", str(task_path), "--output", str(result_path)])

    assert code == 0
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "task_result"
    assert payload["output"]["status"] == "SUCCESS"


def test_model_fake_poll_returns_local_video_artifact_with_requested_duration(tmp_path, monkeypatch):
    task_path = tmp_path / "task.json"
    result_path = tmp_path / "result.json"
    task_path.write_text(
        json.dumps(
            {
                "ok": True,
                "apiVersion": "aos-cli.model/v1",
                "task": "video.ep001.scn001.clip001",
                "capability": "video.generate",
                "output": {
                    "kind": "task",
                    "taskId": "fake-video-task",
                    "raw": {"requestedDurationSeconds": 11},
                },
                "provider": "ark",
                "model": "fake-video-model",
                "usage": {},
                "latencyMs": 1,
                "warnings": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "poll", "--input", str(task_path), "--output", str(result_path)])

    assert code == 0
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    artifact = payload["output"]["artifacts"][0]
    assert artifact["kind"] == "video"
    assert artifact["durationSeconds"] == 11
    assert artifact["lastFrameUrl"].startswith("https://example.test/aos-cli-fake/")
    assert artifact["uri"].startswith("file://")
    assert Path(artifact["uri"].removeprefix("file://")).is_file()


def test_model_fake_poll_can_render_valid_local_video_artifact(tmp_path, monkeypatch):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return

    task_path = tmp_path / "task.json"
    result_path = tmp_path / "result.json"
    task_path.write_text(
        json.dumps(
            {
                "ok": True,
                "apiVersion": "aos-cli.model/v1",
                "task": "video.ep001.scn001.clip001",
                "capability": "video.generate",
                "output": {
                    "kind": "task",
                    "taskId": "fake-video-task-valid",
                    "raw": {"requestedDurationSeconds": 2},
                },
                "provider": "ark",
                "model": "fake-video-model",
                "usage": {},
                "latencyMs": 1,
                "warnings": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE_VIDEO_VALID", "1")
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE_ARTIFACT_DIR", str(tmp_path / "artifacts"))
    code = main(["model", "poll", "--input", str(task_path), "--output", str(result_path)])

    assert code == 0
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    artifact = payload["output"]["artifacts"][0]
    video_path = Path(artifact["uri"].removeprefix("file://"))
    assert video_path.is_file()
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert abs(float(probe.stdout.strip()) - 2.0) < 0.2


def test_model_submit_accepts_request_without_output_kind(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "task.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "video.clip",
                "capability": "video.generate",
                "input": {"prompt": "moonlight"},
            }
        ),
        encoding="utf-8",
    )

    code = main(["model", "submit", "--input", str(request_path), "--output", str(output_path)])

    assert code == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "task"
    assert payload["output"]["taskId"]


def test_model_poll_accepts_request_without_output_kind(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "result.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "video.clip",
                "capability": "video.generate",
                "input": {"taskId": "fake-video-task"},
            }
        ),
        encoding="utf-8",
    )

    code = main(["model", "poll", "--input", str(request_path), "--output", str(output_path)])

    assert code == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "task_result"


def test_model_submit_rejects_task_result_kind(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "task.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "video.clip",
                "capability": "video.generate",
                "output": {"kind": "task_result"},
                "input": {"prompt": "moonlight"},
            }
        ),
        encoding="utf-8",
    )

    code = main(["model", "submit", "--input", str(request_path), "--output", str(output_path)])

    assert code == 2
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["message"] == "submit output.kind must be task or omitted"


def test_model_poll_rejects_task_kind(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "result.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "video.clip",
                "capability": "video.generate",
                "output": {"kind": "task"},
                "input": {"taskId": "fake-video-task"},
            }
        ),
        encoding="utf-8",
    )

    code = main(["model", "poll", "--input", str(request_path), "--output", str(output_path)])

    assert code == 2
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["message"] == "poll output.kind must be task_result or omitted"


def test_model_submit_reports_invalid_json_input(tmp_path):
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "task.json"
    request_path.write_text("{bad", encoding="utf-8")

    code = main(["model", "submit", "--input", str(request_path), "--output", str(output_path)])

    assert code == 2
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"


def test_model_poll_reports_missing_input_file(tmp_path):
    output_path = tmp_path / "result.json"

    code = main(
        [
            "model",
            "poll",
            "--input",
            str(tmp_path / "missing.json"),
            "--output",
            str(output_path),
        ]
    )

    assert code == 2
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
