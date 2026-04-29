#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Regression tests for asset image output contracts.
"""
import json
import tempfile
import unittest
from pathlib import Path

import generate_props
import generate_scenes


class AssetOutputContractTest(unittest.TestCase):
    def test_scene_outputs_single_multi_view_composite_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_composite = root / "composite.png"
            source_ref = root / "legacy_ref.png"
            source_composite.write_bytes(b"composite")
            source_ref.write_bytes(b"legacy_ref")

            scene_state = {
                "name": "Laundry Room",
                "scene_id": "scn_001",
                "element_id": "loc_001",
                "ref_path": str(source_ref),
                "_main_show_url": "https://example.test/composite",
                "ref_show_url": "https://example.test/legacy-ref",
            }
            task_state = {"image_path": str(source_composite)}

            generate_scenes._stage_scene_images_single(scene_state, task_state, root / "_temp")
            generate_scenes._finalize_scene_to_output(scene_state, root / "output", root / "_temp")

            location_dir = root / "output" / "locations" / "Laundry Room"
            self.assertTrue((location_dir / "多视图.png").exists())
            self.assertFalse((location_dir / "主图.png").exists())
            self.assertFalse((location_dir / "特写附图.png").exists())

            metadata = json.loads((root / "output" / "locations" / "locations.json").read_text(encoding="utf-8"))
            entry = metadata["scn_001"]
            self.assertEqual(entry["main"], "locations/Laundry Room/多视图.png")
            self.assertEqual(entry["main_url"], "https://example.test/composite")
            self.assertEqual(entry["views"], "locations/Laundry Room/多视图.png")
            self.assertEqual(entry["views_url"], "https://example.test/composite")
            self.assertEqual(entry["auxiliary"], "")
            self.assertEqual(entry["auxiliary_url"], "")

    def test_prop_outputs_only_main_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_main = root / "main.png"
            source_ref = root / "ref.png"
            source_main.write_bytes(b"main")
            source_ref.write_bytes(b"ref")

            prop_state = {
                "name": "Silver Locket",
                "prop_id": "prop_001",
                "element_id": "prp_001",
                "main_task_id": "task_001",
                "ref_path": str(source_ref),
                "_main_show_url": "https://example.test/main",
                "ref_show_url": "https://example.test/ref",
            }
            task_state = {"image_path": str(source_main)}

            generate_props._stage_prop_images_single(prop_state, task_state, root / "_temp")
            generate_props._finalize_prop_to_output(prop_state, root / "output", root / "_temp")

            prop_dir = root / "output" / "props" / "Silver Locket"
            self.assertTrue((prop_dir / "多角度图.png").exists())
            self.assertFalse((prop_dir / "主图.png").exists())
            self.assertFalse((prop_dir / "特写附图.png").exists())

            metadata = json.loads((root / "output" / "props" / "props.json").read_text(encoding="utf-8"))
            entry = metadata["prop_001"]
            self.assertEqual(entry["main"], "props/Silver Locket/多角度图.png")
            self.assertEqual(entry["main_url"], "https://example.test/main")
            self.assertEqual(entry["auxiliary"], "")
            self.assertEqual(entry["auxiliary_url"], "")


if __name__ == "__main__":
    unittest.main()
