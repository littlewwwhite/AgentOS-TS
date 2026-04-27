import json

from aos_cli.cli import main
from aos_cli.model.errors import AUTH_ERROR, PROVIDER_REJECTED, RATE_LIMITED
from aos_cli.model.registry import CAPABILITIES
from aos_cli.model.preflight import classify_probe_response, preflight_payload


def test_preflight_rejects_html_response():
    result = classify_probe_response(200, "text/html", "<!DOCTYPE html>")

    assert result["ok"] is False
    assert result["error"]["code"] == PROVIDER_REJECTED


def test_preflight_classifies_auth_failure():
    result = classify_probe_response(401, "application/json", '{"error":"bad key"}')

    assert result["ok"] is False
    assert result["error"]["code"] == AUTH_ERROR


def test_preflight_classifies_quota_failure():
    result = classify_probe_response(429, "application/json", '{"error":"quota"}')

    assert result["ok"] is False
    assert result["error"]["code"] == RATE_LIMITED


def test_preflight_reports_missing_gemini_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("AOS_CLI_MODEL_FAKE", raising=False)

    payload = preflight_payload()

    assert payload["ok"] is False
    checks = {check["capability"]: check for check in payload["checks"]}
    assert checks["generate"]["error"]["code"] == AUTH_ERROR
    assert checks["generate"]["probeMode"] == "provider"
    assert checks["embed"]["probeMode"] == "env"


def test_preflight_cli_prints_json(capsys, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")

    code = main(["model", "preflight", "--json"])

    assert code == 0
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["ok"] is True


def test_preflight_fake_mode_reports_all_registered_capabilities(monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")

    payload = preflight_payload()

    checks = {check["capability"]: check for check in payload["checks"]}
    assert set(checks) == set(CAPABILITIES)
    assert all(check["ok"] for check in checks.values())
    assert all(check["probeMode"] == "fake" for check in checks.values())


def test_preflight_missing_openai_key_marks_image_failed(monkeypatch):
    monkeypatch.delenv("AOS_CLI_MODEL_FAKE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("ARK_API_KEY", "ark-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        "aos_cli.model.preflight._probe_gemini",
        lambda base_url, model, api_key: (200, "application/json", "{}"),
    )

    payload = preflight_payload()

    checks = {check["capability"]: check for check in payload["checks"]}
    assert checks["generate"]["ok"] is True
    assert checks["generate"]["probeMode"] == "provider"
    assert checks["image.generate"]["ok"] is False
    assert checks["image.generate"]["probeMode"] == "env"
    assert checks["image.generate"]["error"]["code"] == AUTH_ERROR


def test_preflight_missing_ark_key_marks_video_failed(monkeypatch):
    monkeypatch.delenv("AOS_CLI_MODEL_FAKE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    monkeypatch.delenv("ARK_API_KEY", raising=False)
    monkeypatch.setattr(
        "aos_cli.model.preflight._probe_gemini",
        lambda base_url, model, api_key: (200, "application/json", "{}"),
    )

    payload = preflight_payload()

    checks = {check["capability"]: check for check in payload["checks"]}
    assert checks["video.generate"]["ok"] is False
    assert checks["video.generate"]["probeMode"] == "env"
    assert checks["video.generate"]["error"]["code"] == AUTH_ERROR


def test_preflight_provider_probe_failure_keeps_provider_mode(monkeypatch):
    monkeypatch.delenv("AOS_CLI_MODEL_FAKE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    monkeypatch.setenv("ARK_API_KEY", "ark-key")
    monkeypatch.setattr(
        "aos_cli.model.preflight._probe_gemini",
        lambda base_url, model, api_key: (429, "application/json", '{"error":"quota"}'),
    )

    payload = preflight_payload()

    checks = {check["capability"]: check for check in payload["checks"]}
    assert checks["generate"]["ok"] is False
    assert checks["generate"]["probeMode"] == "provider"
    assert checks["generate"]["error"]["code"] == RATE_LIMITED


def test_preflight_provider_non_json_failure_keeps_provider_mode(monkeypatch):
    monkeypatch.delenv("AOS_CLI_MODEL_FAKE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    monkeypatch.setenv("ARK_API_KEY", "ark-key")
    monkeypatch.setattr(
        "aos_cli.model.preflight._probe_gemini",
        lambda base_url, model, api_key: (200, "application/json", "not-json"),
    )

    payload = preflight_payload()

    checks = {check["capability"]: check for check in payload["checks"]}
    assert checks["generate"]["ok"] is False
    assert checks["generate"]["probeMode"] == "provider"
    assert checks["generate"]["error"]["code"] == PROVIDER_REJECTED


def test_preflight_success_modes_are_explicit(monkeypatch):
    monkeypatch.delenv("AOS_CLI_MODEL_FAKE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    monkeypatch.setenv("ARK_API_KEY", "ark-key")
    monkeypatch.setattr(
        "aos_cli.model.preflight._probe_gemini",
        lambda base_url, model, api_key: (200, "application/json", "{}"),
    )

    payload = preflight_payload()

    checks = {check["capability"]: check for check in payload["checks"]}
    assert checks["generate"]["probeMode"] == "provider"
    assert checks["vision.analyze"]["probeMode"] == "env"
    assert checks["vision.review"]["probeMode"] == "env"
    assert checks["video.analyze"]["probeMode"] == "env"
    assert checks["audio.transcribe"]["probeMode"] == "env"
    assert checks["embed"]["probeMode"] == "env"
    assert checks["image.generate"]["probeMode"] == "env"
    assert checks["video.generate"]["probeMode"] == "env"
