import json

from aos_cli.cli import main
from aos_cli.model.batch import parse_batch_manifest


def test_parse_batch_manifest_accepts_valid_manifest(tmp_path):
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "response.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "x",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {},
            }
        ),
        encoding="utf-8",
    )

    manifest = {
        "apiVersion": "aos-cli.model.batch/v1",
        "concurrency": 2,
        "jobs": [{"id": "job-1", "request": str(request_path), "output": str(output_path)}],
    }

    parsed = parse_batch_manifest(manifest)
    assert parsed["concurrency"] == 2
    assert parsed["jobs"][0]["id"] == "job-1"


def test_model_batch_validate_reports_invalid_manifest(tmp_path, capsys):
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps({"apiVersion": "bad", "jobs": []}), encoding="utf-8")

    code = main(
        [
            "model",
            "batch",
            "--manifest",
            str(manifest_path),
            "--report",
            str(tmp_path / "report.json"),
        ]
    )

    assert code == 2
    assert capsys.readouterr().out == ""
    payload = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"


def test_model_batch_reports_manifest_io_failure(tmp_path, capsys):
    code = main(
        [
            "model",
            "batch",
            "--manifest",
            str(tmp_path / "missing.json"),
            "--report",
            str(tmp_path / "report.json"),
        ]
    )

    assert code == 2
    assert capsys.readouterr().out == ""
    payload = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"


def test_batch_executes_jobs_and_writes_report(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "response.json"
    report_path = tmp_path / "report.json"
    manifest_path = tmp_path / "manifest.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "batch.text",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
            }
        ),
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model.batch/v1",
                "concurrency": 1,
                "jobs": [{"id": "job-1", "request": str(request_path), "output": str(output_path)}],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "batch", "--manifest", str(manifest_path), "--report", str(report_path)])

    assert code == 0
    assert json.loads(output_path.read_text(encoding="utf-8"))["ok"] is True
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["ok"] is True
    assert report["total"] == 1
    assert report["succeeded"] == 1
