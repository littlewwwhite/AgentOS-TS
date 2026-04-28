#!/usr/bin/env python3
# input: provider-facing prompts with legacy subject brackets and dialogue brackets
# output: bracket conversion that preserves dialogue speaker metadata
# pos: regression coverage for VIDEO prompt compatibility cleanup
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))


def test_convert_prompt_brackets_preserves_dialogue_metadata():
    from batch_generate import convert_prompt_brackets

    prompt = "对白：【[图1]｜愤怒｜低沉｜慢速｜沙哑】\"Stop.\""

    assert convert_prompt_brackets(prompt) == prompt


def test_convert_prompt_brackets_keeps_legacy_subject_name_behavior():
    from batch_generate import convert_prompt_brackets

    assert convert_prompt_brackets("【钟离书雨（重伤血衣）】走入") == "{钟离书雨}走入"
