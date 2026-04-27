import io
import json

from aos_cli.cli import _read_input_text, _write_output_text, main


def test_read_input_text_reads_stdin_when_dash(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO("hello"))
    assert _read_input_text("-") == "hello"


def test_read_input_text_reads_file_when_path(tmp_path):
    path = tmp_path / "in.json"
    path.write_text("hi", encoding="utf-8")
    assert _read_input_text(str(path)) == "hi"


def test_write_output_text_writes_stdout_when_dash(capsys):
    _write_output_text("-", "payload")
    captured = capsys.readouterr()
    assert captured.out == "payload\n"


def test_write_output_text_writes_file_when_path(tmp_path):
    path = tmp_path / "out.json"
    _write_output_text(str(path), "payload")
    assert path.read_text(encoding="utf-8") == "payload\n"


def test_write_output_text_appends_trailing_newline(tmp_path):
    path = tmp_path / "out.json"
    _write_output_text(str(path), "{\"k\": 1}")
    assert path.read_text(encoding="utf-8") == "{\"k\": 1}\n"


def test_write_output_text_does_not_double_newline(tmp_path):
    path = tmp_path / "out.json"
    _write_output_text(str(path), "x\n")
    assert path.read_text(encoding="utf-8") == "x\n"


def test_write_output_text_stdout_appends_newline(capsys):
    _write_output_text("-", "{\"k\": 1}")
    captured = capsys.readouterr()
    assert captured.out == "{\"k\": 1}\n"


def test_model_validate_prints_valid_response_json(tmp_path, capsys):
    request_path = tmp_path / "request.json"
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

    code = main(["model", "validate", "--input", str(request_path)])

    assert code == 0
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload == {
        "ok": True,
        "apiVersion": "aos-cli.model/v1",
        "task": "test.text",
        "capability": "generate",
        "warnings": [],
    }
    assert captured.err == ""


def test_model_validate_prints_invalid_response_json(tmp_path, capsys):
    request_path = tmp_path / "request.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "test.text",
                "capability": "generate",
                "output": {"kind": "text"},
            }
        ),
        encoding="utf-8",
    )

    code = main(["model", "validate", "--input", str(request_path)])

    assert code == 2
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["ok"] is False
    assert payload["apiVersion"] == "aos-cli.model/v1"
    assert payload["task"] == "test.text"
    assert payload["capability"] == "generate"
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["warnings"] == []
    assert captured.err == ""


def test_model_validate_does_not_build_model_service(tmp_path, capsys, monkeypatch):
    request_path = tmp_path / "request.json"
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

    def fail_build():
        raise AssertionError("build_default_model_service should not be called")

    monkeypatch.setattr("aos_cli.cli.build_default_model_service", fail_build)

    code = main(["model", "validate", "--input", str(request_path)])

    assert code == 0
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["ok"] is True
    assert captured.err == ""
