import json

from aos_cli.cli import main
from aos_cli.model.capabilities import capabilities_payload
from aos_cli.model.config import DEFAULT_GEMINI_TEXT_MODEL
from aos_cli.model.registry import CAPABILITIES, get_capability


def test_capabilities_declares_generate_text_and_json():
    payload = capabilities_payload()

    names = {item["name"] for item in payload["capabilities"]}
    assert "generate" in names
    generate = next(item for item in payload["capabilities"] if item["name"] == "generate")
    assert "text" in generate["outputKinds"]
    assert "json" in generate["outputKinds"]
    assert "gemini" in generate["providers"]


def test_capabilities_and_protocol_share_generate_metadata():
    payload = capabilities_payload()
    generate = next(item for item in payload["capabilities"] if item["name"] == "generate")
    capability = get_capability("generate")

    assert capability is not None
    assert generate["outputKinds"] == list(capability.output_kinds)
    assert generate["providers"] == list(capability.providers)


def test_capabilities_declares_image_generate_artifacts():
    payload = capabilities_payload()
    image = next(item for item in payload["capabilities"] if item["name"] == "image.generate")

    assert image["outputKinds"] == ["artifact"]
    assert image["providers"] == ["openai_compatible"]
    assert image["models"] == ["gpt-image-2"]


def test_capabilities_declares_video_generate_task_lifecycle():
    payload = capabilities_payload()
    video = next(item for item in payload["capabilities"] if item["name"] == "video.generate")

    assert video["outputKinds"] == ["task", "task_result"]
    assert video["providers"] == ["ark"]
    assert video["models"] == ["ep-20260303234827-tfnzm"]


def test_capabilities_declares_vision_analyze_json():
    payload = capabilities_payload()
    vision = next(item for item in payload["capabilities"] if item["name"] == "vision.analyze")

    assert vision["outputKinds"] == ["json"]
    assert vision["providers"] == ["gemini"]


def test_capabilities_declares_audio_transcribe_json():
    payload = capabilities_payload()
    audio = next(item for item in payload["capabilities"] if item["name"] == "audio.transcribe")

    assert audio["outputKinds"] == ["json"]
    assert audio["providers"] == ["gemini"]


def test_capabilities_declares_embed_vector():
    payload = capabilities_payload()
    embed = next(c for c in payload["capabilities"] if c["name"] == "embed")
    assert embed["outputKinds"] == ["vector"]
    assert embed["providers"] == ["gemini"]


def test_every_registry_capability_appears_once_in_capabilities_payload():
    payload = capabilities_payload()
    names = [capability["name"] for capability in payload["capabilities"]]

    assert len(names) == len(set(names))
    assert set(names) == set(CAPABILITIES)


def test_capabilities_payload_uses_registry_output_kinds():
    payload = capabilities_payload()
    by_name = {capability["name"]: capability for capability in payload["capabilities"]}

    for name, capability in CAPABILITIES.items():
        assert tuple(by_name[name]["outputKinds"]) == capability.output_kinds


def test_capabilities_payload_uses_registry_provider_and_model_lists(monkeypatch):
    monkeypatch.delenv("GEMINI_TEXT_MODEL", raising=False)
    payload = capabilities_payload()
    by_name = {capability["name"]: capability for capability in payload["capabilities"]}

    for name, capability in CAPABILITIES.items():
        assert tuple(by_name[name]["providers"]) == capability.providers
        expected_models = (
            [DEFAULT_GEMINI_TEXT_MODEL]
            if name == "generate"
            else list(capability.models)
        )
        assert by_name[name]["models"] == expected_models


def test_capabilities_payload_uses_overridden_generate_model(monkeypatch):
    monkeypatch.setenv("GEMINI_TEXT_MODEL", "gemini-test-model")

    payload = capabilities_payload()
    generate = next(item for item in payload["capabilities"] if item["name"] == "generate")

    assert generate["models"] == ["gemini-test-model"]


def test_capabilities_cli_prints_json(capsys):
    code = main(["model", "capabilities", "--json"])

    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["apiVersion"] == "aos-cli.model/v1"
