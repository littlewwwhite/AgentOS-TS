#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the image_path_to_data_uri boundary helper."""

import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


class TestImagePathToDataUri(unittest.TestCase):
    def test_jpeg_returns_data_uri_with_jpeg_mime(self):
        from video_api import image_path_to_data_uri

        payload_bytes = b"\xff\xd8\xff\xe0fake jpeg bytes"
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as fh:
            fh.write(payload_bytes)
            path = fh.name
        try:
            result = image_path_to_data_uri(path)
            self.assertTrue(result.startswith("data:image/jpeg;base64,"))
            encoded = result.split(",", 1)[1]
            self.assertEqual(base64.b64decode(encoded), payload_bytes)
        finally:
            os.unlink(path)

    def test_png_returns_data_uri_with_png_mime(self):
        from video_api import image_path_to_data_uri

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as fh:
            fh.write(b"\x89PNG\r\n\x1a\nfake png")
            path = fh.name
        try:
            result = image_path_to_data_uri(path)
            self.assertTrue(result.startswith("data:image/png;base64,"))
        finally:
            os.unlink(path)

    def test_uppercase_extension_normalized(self):
        from video_api import image_path_to_data_uri

        with tempfile.NamedTemporaryFile(suffix=".JPG", delete=False) as fh:
            fh.write(b"\xff\xd8\xff\xe0")
            path = fh.name
        try:
            result = image_path_to_data_uri(path)
            self.assertTrue(result.startswith("data:image/jpeg;base64,"))
        finally:
            os.unlink(path)

    def test_unsupported_extension_raises(self):
        from video_api import image_path_to_data_uri

        with tempfile.NamedTemporaryFile(suffix=".bmp", delete=False) as fh:
            fh.write(b"BM")
            path = fh.name
        try:
            with self.assertRaises(ValueError):
                image_path_to_data_uri(path)
        finally:
            os.unlink(path)

    def test_missing_file_raises(self):
        from video_api import image_path_to_data_uri

        with self.assertRaises(FileNotFoundError):
            image_path_to_data_uri("/nonexistent/path/missing.jpg")


if __name__ == "__main__":
    unittest.main()
