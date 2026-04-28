#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the video_api → aos-cli boundary contract.

Verifies the lsi continuity frame is routed via `referenceImages` with
`role:first_frame` and that the legacy `firstFrameUrl` string field is
no longer emitted (aos-cli does not read it).
"""

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


class TestSubmitVideoBoundary(unittest.TestCase):
    def setUp(self):
        import video_api

        self.video_api = video_api
        self._captured = {}

        def fake_submit_envelope(envelope, cwd, tmp_prefix):
            self._captured["envelope"] = envelope
            return {
                "ok": True,
                "output": {"kind": "task", "taskId": "tk_test_123"},
                "model": "ep-fake",
            }

        self._orig = video_api.submit_envelope
        video_api.submit_envelope = fake_submit_envelope

    def tearDown(self):
        self.video_api.submit_envelope = self._orig

    def test_reference_only_mode_emits_subject_refs_no_first_frame(self):
        """Subject-binding mode: refs all role=reference_image, no first_frame."""
        self.video_api.submit_video_generation(
            prompt="[图1] in [图2]",
            duration=5,
            ratio="16:9",
            quality="720p",
            project_dir=".",
            task="video.test",
            reference_images=[
                {"url": "https://x/act.png", "role": "reference_image", "name": "act_001"},
                {"url": "https://x/loc.png", "role": "reference_image", "name": "loc_001"},
            ],
            first_frame_url=None,
        )
        envelope = self._captured["envelope"]
        input_payload = envelope["input"]
        self.assertNotIn("firstFrameUrl", input_payload)
        refs = input_payload["referenceImages"]
        self.assertEqual(len(refs), 2)
        self.assertTrue(all(r["role"] == "reference_image" for r in refs))

    def test_asset_uri_reference_image_passes_through(self):
        self.video_api.submit_video_generation(
            prompt="[图1] turns around",
            duration=5,
            ratio="16:9",
            quality="720p",
            project_dir=".",
            task="video.test",
            reference_images=[
                {
                    "url": "asset://asset-20260222234430-mxpgh",
                    "role": "reference_image",
                    "name": "act_001",
                },
            ],
            first_frame_url=None,
        )

        refs = self._captured["envelope"]["input"]["referenceImages"]
        self.assertEqual(refs[0]["url"], "asset://asset-20260222234430-mxpgh")

    def test_data_uri_first_frame_passes_through(self):
        data_uri = "data:image/jpeg;base64,/9j/4AAQSk"
        self.video_api.submit_video_generation(
            prompt="text only",
            duration=5,
            ratio="16:9",
            quality="720p",
            project_dir=".",
            task="video.test",
            reference_images=None,
            first_frame_url=data_uri,
        )
        envelope = self._captured["envelope"]
        input_payload = envelope["input"]
        self.assertNotIn("firstFrameUrl", input_payload)
        refs = input_payload["referenceImages"]
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["url"], data_uri)
        self.assertEqual(refs[0]["role"], "first_frame")

    def test_no_first_frame_url_no_first_frame_emitted(self):
        self.video_api.submit_video_generation(
            prompt="text only",
            duration=5,
            ratio="16:9",
            quality="720p",
            project_dir=".",
            task="video.test",
            reference_images=[
                {"url": "https://x/act.png", "role": "reference_image"},
            ],
            first_frame_url=None,
        )
        envelope = self._captured["envelope"]
        input_payload = envelope["input"]
        self.assertNotIn("firstFrameUrl", input_payload)
        refs = input_payload["referenceImages"]
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["role"], "reference_image")

    def test_mutex_subject_refs_and_first_frame_rejected(self):
        """Ark Seedance 2.0 rejects mixing reference_image + first/last frame.

        The boundary must fail-fast so callers see this constraint without
        needing to hit Ark and parse an opaque InvalidParameter response.
        """
        with self.assertRaises(ValueError) as ctx:
            self.video_api.submit_video_generation(
                prompt="[图1] 凝视前方",
                duration=5,
                ratio="16:9",
                quality="720p",
                project_dir=".",
                task="video.test",
                reference_images=[
                    {"url": "https://x/act.png", "role": "reference_image", "name": "act_001"},
                ],
                first_frame_url="https://x/lsi.png",
            )
        self.assertIn("cannot mix", str(ctx.exception))

    def test_reference_videos_forwarded_as_envelope_field(self):
        """reference_videos passes through to envelope.input.referenceVideos."""
        self.video_api.submit_video_generation(
            prompt="[图1] 凝视前方",
            duration=5,
            ratio="16:9",
            quality="720p",
            project_dir=".",
            task="video.test",
            reference_images=[
                {"url": "https://x/act.png", "role": "reference_image", "name": "act_001"},
            ],
            reference_videos=[
                {"url": "https://x/prev.mp4", "role": "reference_video", "name": "prev_video"},
            ],
        )
        envelope = self._captured["envelope"]
        input_payload = envelope["input"]
        videos = input_payload["referenceVideos"]
        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0]["url"], "https://x/prev.mp4")
        self.assertEqual(videos[0]["role"], "reference_video")
        self.assertEqual(videos[0]["name"], "prev_video")

    def test_no_reference_videos_no_envelope_field(self):
        self.video_api.submit_video_generation(
            prompt="text only",
            duration=5,
            ratio="16:9",
            quality="720p",
            project_dir=".",
            task="video.test",
            reference_images=[
                {"url": "https://x/act.png", "role": "reference_image"},
            ],
        )
        envelope = self._captured["envelope"]
        input_payload = envelope["input"]
        self.assertNotIn("referenceVideos", input_payload)

    def test_reference_videos_default_role_filled_in(self):
        self.video_api.submit_video_generation(
            prompt="text only",
            duration=5,
            ratio="16:9",
            quality="720p",
            project_dir=".",
            task="video.test",
            reference_images=None,
            reference_videos=[{"url": "https://x/p.mp4"}],
        )
        envelope = self._captured["envelope"]
        videos = envelope["input"]["referenceVideos"]
        self.assertEqual(videos[0]["role"], "reference_video")

    def test_relative_first_frame_url_rejected(self):
        with self.assertRaises(RuntimeError):
            self.video_api.submit_video_generation(
                prompt="x",
                duration=5,
                ratio="16:9",
                quality="720p",
                project_dir=".",
                task="video.test",
                reference_images=None,
                first_frame_url="/relative/not/public.png",
            )


if __name__ == "__main__":
    unittest.main()
