#!/usr/bin/env python3
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path


class TeeWriterImportCompatibilityTest(unittest.TestCase):
    def test_batch_generate_import_with_wrapped_stdio(self):
        scripts_dir = Path(__file__).resolve().parent
        snippet = textwrap.dedent(
            f"""
            import io
            import sys

            sys.path.insert(0, {str(scripts_dir)!r})

            from compat import TeeWriter

            original_stdout = io.TextIOWrapper(io.BytesIO(), encoding='utf-8')
            original_stderr = io.TextIOWrapper(io.BytesIO(), encoding='utf-8')
            log_file = io.StringIO()

            sys.stdout = TeeWriter(original_stdout, log_file)
            sys.stderr = TeeWriter(original_stderr, log_file)

            import batch_generate  # noqa: F401
            """
        )

        result = subprocess.run(
            [sys.executable, "-c", snippet],
            capture_output=True,
            text=True,
            cwd=scripts_dir,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\\n{result.stdout}\\n\\nstderr:\\n{result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
