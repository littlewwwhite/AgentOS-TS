#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: generated asset metadata and optional local files
# output: no subject ids; provider-neutral compatibility shims
# pos: compatibility boundary after removing platform-specific subject creation

from __future__ import annotations


def process_actor(*, element_name: str, element_description: str = "", element_frontal_image: str = "", dry_run: bool = False, voice_path: str | None = None, element_refer_list=None):
    """Return no subject id.

    Current asset generation uses ChatFire image URLs directly. There is no
    subject/element creation step in the active provider path.
    """
    return None


def upload_to_cos(file_path: str, scene_type: str = "asset-reference"):
    """No remote upload provider is configured for local reference files."""
    return None, None
