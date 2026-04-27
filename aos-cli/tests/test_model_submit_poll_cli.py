import json
from pathlib import Path

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
    assert payload["output"]["taskId"] == "fake-video-task"


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
    assert artifact["uri"].startswith("file://")
    assert Path(artifact["uri"].removeprefix("file://")).is_file()


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
