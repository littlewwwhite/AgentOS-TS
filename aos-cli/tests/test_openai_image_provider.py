from aos_cli.model.providers.openai_image import OpenAIImageProvider, extract_image_urls


def test_extract_image_urls_reads_openai_compatible_response():
    payload = {"data": [{"url": "https://example.com/a.png"}]}
    assert extract_image_urls(payload) == ["https://example.com/a.png"]


class FakeTransport:
    def __init__(self):
        self.last_url = None
        self.last_body = None
        self.last_headers = None
        self.last_timeout = None

    def post_json(self, url, body, headers, timeout):
        self.last_url = url
        self.last_body = body
        self.last_headers = headers
        self.last_timeout = timeout
        return {"data": [{"url": "https://example.com/a.png"}]}


def test_openai_image_provider_posts_generation_request():
    transport = FakeTransport()
    provider = OpenAIImageProvider(
        api_key="key",
        base_url="https://api.example.com",
        model="gpt-image-2",
        transport=transport,
    )

    result = provider.generate_image(prompt="draw", options={"size": "1024x1024"})

    assert transport.last_url == "https://api.example.com/v1/images/generations"
    assert transport.last_body["model"] == "gpt-image-2"
    assert transport.last_body["prompt"] == "draw"
    assert transport.last_body["size"] == "1024x1024"
    assert transport.last_headers["authorization"] == "Bearer key"
    assert result.urls == ["https://example.com/a.png"]
