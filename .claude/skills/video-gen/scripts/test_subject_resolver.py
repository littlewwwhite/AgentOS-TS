#!/usr/bin/env python3
# input: subject_resolver module under video-gen/scripts
# output: unittest assertions for token extraction + prompt rewriting + image resolution
# pos: regression coverage for storyboard @-token → Ark referenceImages[] bridge
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))


class ExtractSubjectTokensTest(unittest.TestCase):
    def test_extracts_at_form_act_loc_prp_in_order(self):
        from subject_resolver import extract_subject_tokens

        prompt = "@act_001 走入 @loc_002，望向 @prp_003"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "loc_002", "prp_003"])

    def test_extracts_legacy_brace_form(self):
        from subject_resolver import extract_subject_tokens

        prompt = "{act_001} 走入 {loc_002}"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "loc_002"])

    def test_dedupes_repeated_tokens_preserving_first_occurrence(self):
        from subject_resolver import extract_subject_tokens

        prompt = "@act_001 转向 @act_002，@act_001 抬手"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "act_002"])

    def test_mixed_at_and_brace_forms(self):
        from subject_resolver import extract_subject_tokens

        prompt = "{act_001} 与 @act_002 在 @loc_003"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "act_002", "loc_003"])


class ResolveSubjectTokensTest(unittest.TestCase):
    def _mapping(self):
        return {
            "act_001": {
                "subject_id": "s1",
                "name": "白行风",
                "type": "actor",
                "image_url": "https://x/a1.png",
            },
            "act_002": {
                "subject_id": "s2",
                "name": "苏父",
                "type": "actor",
                "image_url": "https://x/a2.png",
            },
            "loc_003": {
                "subject_id": "sL",
                "name": "诛仙台",
                "type": "location",
                "image_url": "https://x/L.png",
            },
            "prp_004": {
                "subject_id": "sP",
                "name": "银锭",
                "type": "prop",
                "image_url": "https://x/P.png",
            },
        }

    def test_rewrites_prompt_to_image_indexes_and_orders_refs(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 走入 @loc_003"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 走入 [图2]")
        self.assertEqual([r["url"] for r in refs], ["https://x/a1.png", "https://x/L.png"])
        self.assertEqual(refs[0]["name"], "act_001")
        self.assertEqual(refs[1]["display_name"], "诛仙台")

    def test_each_ref_carries_role_reference_image(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 与 @act_002 在 @loc_003"
        _, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(len(refs), 3)
        self.assertTrue(all(r["role"] == "reference_image" for r in refs))

    def test_dedupes_so_one_token_one_image_one_index(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 转向 @act_002，@act_001 抬手"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 转向 [图2]，[图1] 抬手")
        self.assertEqual(len(refs), 2)

    def test_missing_token_keeps_raw_text_and_skips_url(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 与 @act_999 对话"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 与 @act_999 对话")
        self.assertEqual([r["url"] for r in refs], ["https://x/a1.png"])

    def test_token_with_no_image_url_is_skipped(self):
        from subject_resolver import resolve_subject_tokens

        mapping = {
            "act_001": {
                "subject_id": "s1",
                "name": "X",
                "type": "actor",
                "image_url": "",
            }
        }
        prompt = "@act_001 出场"
        rewritten, refs = resolve_subject_tokens(prompt, mapping)
        self.assertEqual(rewritten, "@act_001 出场")
        self.assertEqual(refs, [])

    def test_mixed_form_resolution(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "{act_001} 与 @act_002 在 @loc_003"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 与 [图2] 在 [图3]")
        self.assertEqual(len(refs), 3)

    def test_prp_token_resolves(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 拿起 @prp_004"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 拿起 [图2]")
        self.assertEqual(refs[1]["url"], "https://x/P.png")


if __name__ == "__main__":
    unittest.main()
