#!/usr/bin/env python3
"""
Shared AWB preflight check for all skills that depend on AWB authentication
and common Python/system dependencies.

Usage:
    # Login check only (all AWB skills)
    python3 preflight_awb.py --check login

    # Login + common deps (asset-gen, video-gen, etc.)
    python3 preflight_awb.py --check login,deps --deps google-genai,Pillow --cmds ffmpeg

    # Login + Gemini config (asset-gen)
    python3 preflight_awb.py --check login,deps,gemini-config \
        --deps google-genai,Pillow,demucs,soundfile --cmds curl,ffmpeg \
        --gemini-config /path/to/gemini_backend.json

    # Storyboard-generate style
    python3 preflight_awb.py --check login,deps \
        --deps google-genai,python-dotenv --cmds ffmpeg --env GEMINI_API_KEY

Exit codes:
    0 = all checks passed
    1 = one or more checks failed (details printed to stderr)
"""

import argparse
import importlib
import json
import os
import shutil
import sys
from pathlib import Path

# Map pip package names to importable module names
PKG_TO_MODULE = {
    "google-genai": "google.genai",
    "Pillow": "PIL",
    "python-dotenv": "dotenv",
    "scenedetect[opencv]": "scenedetect",
}


def check_login() -> bool:
    """Check AWB login status via awb_get_auth convention.
    Returns True if token file exists and is non-empty."""
    # AWB auth stores token in ~/.awb/auth.json (managed by MCP awb server)
    auth_path = Path.home() / ".awb" / "auth.json"
    if not auth_path.exists():
        print("AWB: not logged in (no auth file)", file=sys.stderr)
        print("ACTION: call Skill(awb-login) to authenticate", file=sys.stderr)
        return False
    try:
        data = json.loads(auth_path.read_text())
        if data.get("token") or data.get("accessToken"):
            print("AWB: logged in")
            return True
        print("AWB: auth file exists but no token found", file=sys.stderr)
        print("ACTION: call Skill(awb-login) to re-authenticate", file=sys.stderr)
        return False
    except (json.JSONDecodeError, KeyError):
        print("AWB: auth file is corrupt", file=sys.stderr)
        print("ACTION: call Skill(awb-login) to re-authenticate", file=sys.stderr)
        return False


def check_deps(packages: list[str], commands: list[str], env_vars: list[str]) -> bool:
    """Check Python packages, system commands, and environment variables."""
    missing = []

    for pkg in packages:
        mod = PKG_TO_MODULE.get(pkg, pkg)
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(f"pip: {pkg}")

    for cmd in commands:
        if not shutil.which(cmd):
            missing.append(f"cmd: {cmd}")

    for var in env_vars:
        if not os.getenv(var):
            missing.append(f"env: {var}")

    if missing:
        print(f"Missing dependencies: {', '.join(missing)}", file=sys.stderr)
        return False

    print("Dependencies: all ready")
    return True


def check_gemini_config(config_path: str) -> bool:
    """Validate Gemini backend configuration file."""
    p = Path(config_path)
    if not p.exists():
        print(f"Gemini config not found: {config_path}", file=sys.stderr)
        return False

    try:
        cfg = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        print(f"Gemini config invalid JSON: {e}", file=sys.stderr)
        return False

    mode = cfg.get("mode", "official")
    if mode == "proxy":
        key = cfg.get("proxy", {}).get("api_key") or os.getenv("GEMINI_PROXY_KEY")
        url = cfg.get("proxy", {}).get("base_url")
        if not key:
            print("Gemini proxy mode: api_key not configured", file=sys.stderr)
            return False
        if not url:
            print("Gemini proxy mode: base_url not configured", file=sys.stderr)
            return False
        print(f"Gemini: proxy mode, model={cfg.get('model', '?')}")
    else:
        key = cfg.get("official", {}).get("api_key") or os.getenv("GEMINI_API_KEY")
        if not key:
            print("Gemini official mode: api_key not configured", file=sys.stderr)
            return False
        print(f"Gemini: official mode, model={cfg.get('model', '?')}")

    return True


def main():
    parser = argparse.ArgumentParser(description="AWB preflight checks")
    parser.add_argument(
        "--check",
        default="login",
        help="Comma-separated checks: login,deps,gemini-config",
    )
    parser.add_argument(
        "--deps", default="", help="Comma-separated pip package names to check"
    )
    parser.add_argument(
        "--cmds", default="", help="Comma-separated system commands to check"
    )
    parser.add_argument(
        "--env", default="", help="Comma-separated env vars to check"
    )
    parser.add_argument(
        "--gemini-config", default="", help="Path to gemini_backend.json"
    )
    args = parser.parse_args()

    checks = [c.strip() for c in args.check.split(",") if c.strip()]
    all_ok = True

    for check in checks:
        if check == "login":
            if not check_login():
                all_ok = False
        elif check == "deps":
            pkgs = [p.strip() for p in args.deps.split(",") if p.strip()]
            cmds = [c.strip() for c in args.cmds.split(",") if c.strip()]
            envs = [e.strip() for e in args.env.split(",") if e.strip()]
            if not check_deps(pkgs, cmds, envs):
                all_ok = False
        elif check == "gemini-config":
            if not args.gemini_config:
                print("--gemini-config path required", file=sys.stderr)
                all_ok = False
            elif not check_gemini_config(args.gemini_config):
                all_ok = False
        else:
            print(f"Unknown check: {check}", file=sys.stderr)
            all_ok = False

    if all_ok:
        print("All preflight checks passed")
    else:
        print("Preflight checks FAILED", file=sys.stderr)

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
