from aos_cli.model.providers.ark_video import ArkVideoProvider, build_ark_video_task_body, extract_ark_task_id


class FakeTransport:
    def __init__(self, payload):
        self.payload = payload
        self.last_body = None

    def post_json(self, url, body, headers, timeout):
        self.last_body = body
        return self.payload


def test_build_ark_video_task_body_uses_model_and_reference_images():
    body = build_ark_video_task_body(
        model="ep-20260303234827-tfnzm",
        prompt="move",
        reference_images=[{"url": "https://example.com/ref.png", "role": "reference_image"}],
        duration=6,
        ratio="9:16",
        resolution="720p",
    )

    assert body["model"] == "ep-20260303234827-tfnzm"
    assert body["content"][0]["type"] == "text"
    assert any(item["type"] == "image_url" for item in body["content"])
    assert body["resolution"] == "720p"


def test_build_ark_video_task_body_keeps_resolution_explicit():
    body = build_ark_video_task_body(
        model="ep-20260303234827-tfnzm",
        prompt="move",
        resolution="1080p",
    )

    assert body["resolution"] == "1080p"


def test_ark_provider_maps_legacy_standard_quality_to_720p():
    transport = FakeTransport({"id": "task-1"})
    provider = ArkVideoProvider("key", "https://example.com/ark", "ep-test", transport)

    provider.submit_video(prompt="move", options={"quality": "standard"})

    assert transport.last_body["resolution"] == "720p"


def test_ark_provider_prefers_explicit_resolution_over_legacy_quality():
    transport = FakeTransport({"id": "task-1"})
    provider = ArkVideoProvider("key", "https://example.com/ark", "ep-test", transport)

    provider.submit_video(prompt="move", options={"resolution": "1080p", "quality": "standard"})

    assert transport.last_body["resolution"] == "1080p"


def test_extract_ark_task_id_reads_task_response():
    assert extract_ark_task_id({"id": "task-1"}) == "task-1"
