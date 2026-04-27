import json

from aos_cli.cli import main


def test_model_run_writes_response_file(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    response_path = tmp_path / "response.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "test.text",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "run", "--input", str(request_path), "--output", str(response_path)])

    assert code == 0
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "text"


def test_model_run_returns_error_exit_for_failed_response(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    response_path = tmp_path / "response.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "test.text",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.delenv("AOS_CLI_MODEL_FAKE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    code = main(["model", "run", "--input", str(request_path), "--output", str(response_path)])

    assert code == 2
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CONFIG_ERROR"


def test_model_run_writes_image_artifact_response(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    response_path = tmp_path / "response.json"
    artifact_dir = tmp_path / "artifacts"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "asset.character.front",
                "capability": "image.generate",
                "output": {"kind": "artifact"},
                "input": {"prompt": "draw"},
                "artifactPolicy": {"download": True, "localDir": str(artifact_dir)},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "run", "--input", str(request_path), "--output", str(response_path)])

    assert code == 0
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "artifact"
    assert payload["output"]["artifacts"][0]["kind"] == "image"


def test_model_run_reports_missing_input_file(tmp_path):
    response_path = tmp_path / "response.json"

    code = main(
        [
            "model",
            "run",
            "--input",
            str(tmp_path / "missing.json"),
            "--output",
            str(response_path),
        ]
    )

    assert code == 2
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"


def test_model_run_reports_invalid_json_input(tmp_path):
    request_path = tmp_path / "request.json"
    response_path = tmp_path / "response.json"
    request_path.write_text("{bad", encoding="utf-8")

    code = main(["model", "run", "--input", str(request_path), "--output", str(response_path)])

    assert code == 2
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["message"] == "Input file is not valid JSON: Expecting property name enclosed in double quotes"


def test_model_run_reports_non_object_input(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    response_path = tmp_path / "response.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "test.text",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": "hi",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "run", "--input", str(request_path), "--output", str(response_path)])

    assert code == 2
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["message"] == "input must be an object"
