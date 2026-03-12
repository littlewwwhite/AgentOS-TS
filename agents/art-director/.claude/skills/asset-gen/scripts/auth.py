#!/usr/bin/env python3

from pathlib import Path
import sys

SHARED_ROOT = Path(__file__).resolve().parents[5] / "_shared" / "animeworkbench"
if str(SHARED_ROOT) not in sys.path:
    sys.path.insert(0, str(SHARED_ROOT))

from auth_shared import *  # noqa: F401,F403

if __name__ == "__main__":
    main()
