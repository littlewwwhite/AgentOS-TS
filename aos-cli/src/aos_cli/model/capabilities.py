# input: installed provider defaults and model capability configuration
# output: stable capabilities payload for harness discovery
# pos: capability discovery boundary for aos-cli model service

import os

from aos_cli.model.config import DEFAULT_GEMINI_TEXT_MODEL
from aos_cli.model.protocol import API_VERSION
from aos_cli.model.registry import CAPABILITIES


def _capability_models(name: str) -> list[str]:
    if name == "generate":
        return [os.environ.get("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL)]
    return list(CAPABILITIES[name].models)


def capabilities_payload() -> dict:
    return {
        "apiVersion": API_VERSION,
        "capabilities": [
            {
                "name": capability.name,
                "outputKinds": list(capability.output_kinds),
                "providers": list(capability.providers),
                "models": _capability_models(capability.name),
            }
            for capability in CAPABILITIES.values()
        ],
    }
