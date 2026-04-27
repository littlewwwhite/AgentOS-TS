# input: static model capability definitions
# output: capability metadata used by validation and discovery
# pos: single source of truth for supported model capabilities

from dataclasses import dataclass


@dataclass(frozen=True)
class Capability:
    name: str
    output_kinds: tuple[str, ...]
    providers: tuple[str, ...]
    models: tuple[str, ...] = ()


CAPABILITIES: dict[str, Capability] = {
    "generate": Capability(
        name="generate",
        output_kinds=("text", "json"),
        providers=("gemini",),
    ),
    "image.generate": Capability(
        name="image.generate",
        output_kinds=("artifact",),
        providers=("openai_compatible",),
        models=("gpt-image-2",),
    ),
    "video.generate": Capability(
        name="video.generate",
        output_kinds=("task", "task_result"),
        providers=("ark",),
        models=("ep-20260303234827-tfnzm",),
    ),
    "vision.analyze": Capability(
        name="vision.analyze",
        output_kinds=("json",),
        providers=("gemini",),
    ),
    "audio.transcribe": Capability(
        name="audio.transcribe",
        output_kinds=("json",),
        providers=("gemini",),
    ),
    "embed": Capability(
        name="embed",
        output_kinds=("vector",),
        providers=("gemini",),
        models=("gemini-embedding-001",),
    ),
}


def get_capability(name: str) -> Capability | None:
    return CAPABILITIES.get(name)
