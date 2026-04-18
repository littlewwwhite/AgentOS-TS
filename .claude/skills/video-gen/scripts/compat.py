#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compat.py — Cross-platform compatibility utilities

Provides Windows UTF-8 encoding handling and TeeWriter logging tool,
avoiding repetitive compatibility code across multiple scripts.
"""

import sys


def ensure_utf8_output():
    """Ensure stdout/stderr use UTF-8 encoding (primarily fixes Windows mojibake).

    On Windows: sets console code page to UTF-8 and re-wraps stdout/stderr.
    On non-Windows: enables line buffering for real-time log output.
    """
    if sys.platform == 'win32':
        import io
        import subprocess
        subprocess.run('chcp 65001', shell=True, capture_output=True)
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    else:
        # Non-Windows: ensure line buffering for real-time log output
        try:
            sys.stdout.reconfigure(line_buffering=True)
            sys.stderr.reconfigure(line_buffering=True)
        except AttributeError:
            pass


class TeeWriter:
    """Write output to both terminal and a log file simultaneously."""

    def __init__(self, original_stdout, log_file):
        self.original = original_stdout
        self.log_file = log_file

    def write(self, data):
        self.original.write(data)
        self.log_file.write(data)
        self.log_file.flush()

    def flush(self):
        self.original.flush()
        self.log_file.flush()

    def reconfigure(self, *args, **kwargs):
        reconfigure = getattr(self.original, 'reconfigure', None)
        if callable(reconfigure):
            reconfigure(*args, **kwargs)
        return self

    @property
    def encoding(self):
        return getattr(self.original, 'encoding', 'utf-8')
