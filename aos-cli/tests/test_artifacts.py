from aos_cli.model.artifacts import build_artifact_descriptor


def test_build_artifact_descriptor_hashes_local_file(tmp_path):
    image_path = tmp_path / "image.png"
    image_path.write_bytes(b"png")

    descriptor = build_artifact_descriptor(
        path=image_path,
        kind="image",
        mime_type="image/png",
        role="character.front",
        remote_url="https://example.com/image.png",
    )

    assert descriptor["kind"] == "image"
    assert descriptor["uri"].startswith("file://")
    assert descriptor["remoteUrl"] == "https://example.com/image.png"
    assert descriptor["sha256"]
    assert descriptor["bytes"] == 3
