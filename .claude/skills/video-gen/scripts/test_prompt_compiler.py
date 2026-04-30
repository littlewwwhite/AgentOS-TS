#!/usr/bin/env python3
# input: rich storyboard markdown prompts
# output: compact provider-facing prompts preserving timing, actions, refs, and dialogue
# pos: regression coverage for VIDEO prompt slimming boundary
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))


class CompileVideoPromptTest(unittest.TestCase):
    def test_compiles_rich_storyboard_to_lean_provider_prompt(self):
        from prompt_compiler import compile_video_prompt

        source = """PART1

总体描述：夜晚的@loc_001内，@act_001:st_002与@act_002:st_005对峙。音频仅写实对白和环境音，无BGM，画面无文字。

剧情摘要：@act_001:st_002送酒时被@act_002:st_005抓住，刀锋抵住喉咙。

动作节拍 Beats：
[0-3] @act_001:st_002走入房间。
[3-6] @act_002:st_005抓住她。

S1 | 00:00-00:03 | 全景/固定机位
- 运镜：从门口推向房间中央
- 动作：@act_001:st_002端托盘穿过铁门走入@loc_001
- 角色状态：@act_001:st_002 前景，警惕；@act_002:st_005 后景，危险
- 音效：铁门合拢声
- 对白：无

S2 | 00:03-00:06 | 特写/手持机位
- 运镜：快速拉近手腕接触点
- 动作：@act_002:st_005猛抓@act_001:st_002手腕
- 角色状态：@act_001:st_002 失衡，惊愕；@act_002:st_005 前倾，暴戾
- 音效：托盘碰撞声
- 对白：【@act_002:st_005｜威胁｜低沉｜慢速｜磁性】"What are you looking for?"
"""

        compiled = compile_video_prompt(source)

        self.assertIn("00:00-00:03 全景/固定机位", compiled)
        self.assertIn("@act_001:st_002端托盘", compiled)
        self.assertIn("What are you looking for?", compiled)
        self.assertIn("画面保持干净", compiled)
        self.assertNotIn("动作节拍 Beats", compiled)
        self.assertNotIn("PART1", compiled)
        self.assertNotIn("主体/场景：", compiled)
        self.assertNotIn("时间顺序：", compiled)
        self.assertLess(len(compiled), len(source))

    def test_seedance_structure_preserves_asset_tokens_exactly(self):
        from prompt_compiler import compile_video_prompt

        source = """景别/机位 | 中景，低机位缓慢推进

总体描述：@act_001:st_002 在 @loc_001 捡起 @prp_003，@act_002 站在门口。
动作：@act_001:st_002 先看向地面，再迅速把 @prp_003 藏到身后；@act_002 向前一步。
角色状态：@act_001:st_002 紧张但克制；@act_002 怀疑。
音效：木门轻响，衣料摩擦声。
对白：无
"""

        compiled = compile_video_prompt(source)

        self.assertIn("@act_001:st_002 在 @loc_001 捡起 @prp_003，@act_002 站在门口。镜头采用中景，低机位缓慢推进", compiled)
        self.assertIn("@act_001:st_002", compiled)
        self.assertIn("@loc_001", compiled)
        self.assertIn("@prp_003", compiled)
        self.assertNotIn("主体/场景：", compiled)
        self.assertNotIn("动作：", compiled)
        self.assertNotIn("状态：", compiled)
        self.assertNotIn("{act_001", compiled)
        self.assertNotIn("Image 1", compiled)

    def test_plain_prompt_falls_back_to_whitespace_normalization(self):
        from prompt_compiler import compile_video_prompt

        compiled = compile_video_prompt("  @act_001   走入   @loc_001\n\n  抬头。 ")

        self.assertEqual(compiled, "@act_001 走入 @loc_001 抬头。")

    def test_compiles_simple_storyboard_block_without_field_ceremony(self):
        from prompt_compiler import compile_video_prompt

        source = """景别/机位 | 中远景，缓慢推进转跟拍

总体描述：@act_001:st_001 在 @loc_001 洗衣服，被 @act_003 暴力打倒。
动作：@act_001:st_001 双手没入冰水揉搓披风，随后 @act_003 手持 @prp_005 走近，一掌将其击倒。
角色状态：@act_001:st_001 站位在木桶前，脊背挺直；@act_003 侧后方，情绪暴戾。
音效：水声，沉重的巴掌声。
对白：无
"""

        compiled = compile_video_prompt(source)

        self.assertIn("镜头采用中远景", compiled)
        self.assertIn("@act_001:st_001 双手没入冰水", compiled)
        self.assertIn("画面保持干净", compiled)
        self.assertNotIn("景别/机位 |", compiled)
        self.assertNotIn("总体描述：", compiled)
        self.assertNotIn("动作：", compiled)
        self.assertNotIn("状态：", compiled)
        self.assertNotIn("对白：无", compiled)

    def test_preserves_dialogue_without_truncating_quotes(self):
        from prompt_compiler import compile_video_prompt

        line = '"In the laundry room, a crust of dry bread can buy a life! That fat maid was going to kill me!"'
        source = f"""景别/机位 | 近景

总体描述：@act_001:st_001 跪在地上。
动作：@act_001:st_001 砸下铜币。
角色状态：@act_001:st_001 愤怒。
音效：铜币声。
对白：【@act_001:st_001｜furious｜嘶吼｜极快｜沙哑】{line}
"""

        compiled = compile_video_prompt(source)

        self.assertIn(line, compiled)
        self.assertNotIn("…", compiled)


if __name__ == "__main__":
    unittest.main()
