#!/usr/bin/env python3
# input: scripts.pipeline_state writer helpers
# output: regression tests for pipeline-state persistence
# pos: verifies shared pipeline-state writer behavior under concurrent runners

import tempfile
import unittest
from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import pipeline_state


class PipelineStateWriterTest(unittest.TestCase):
    def test_write_state_does_not_reuse_shared_tmp_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pipeline-state.json"
            shared_tmp = path.with_suffix(path.suffix + ".tmp")
            shared_tmp.write_text("do not touch\n", encoding="utf-8")

            pipeline_state.write_state(path, {"version": 1})

            self.assertTrue(shared_tmp.exists())
            self.assertEqual(shared_tmp.read_text(encoding="utf-8"), "do not touch\n")


if __name__ == "__main__":
    unittest.main()
