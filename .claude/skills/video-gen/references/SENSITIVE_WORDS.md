# Sensitive Word Replacement Rules

The following words trigger video platform content moderation and **must be replaced** during prompt generation.

| Original | Replacement |
|----------|-------------|
| 鲜血、血迹、血液、血水、血流、血泊、血腥 | 红色液体、红色痕迹、红色印记 |
| 血溅、血雾、血染 | 红色飞溅、红色弥漫、染红 |
| 死亡、死去、死了、已死、死状 | 消逝、倒下、失去意识、气绝 |
| 杀死、杀掉、斩杀、斩首、砍杀 | 击败、制服、压制、击倒 |
| 杀人、杀敌 | 击倒对手、击败敌人 |
| 尸体、尸骸、尸首、遗体 | 倒地的身影、失去意识的身躯 |
| 割喉、割颈、割腕 | 划过颈部、触碰手腕 |
| 爆头、穿脑 | 强力击中头部 |
| 断肢、残肢、断手、断臂、断腿 | 受创的肢体、倒地的身影 |
| 内脏、肠子、骨髓 | 生命力、内力 |
| 虐待、折磨、凌迟 | 压制、制服 |
| 自杀、轻生、寻死 | 放弃抵抗、失去意志 |
| 爆炸（写实场景）| 强烈冲击、气浪席卷 |

**Principles:**
- Preserve visual effect and emotional tension; only swap the moderation-triggering word
- Xianxia/fantasy prefixed terms (仙血, 灵血, 魔气, etc.) may be kept; realistic terms (鲜血, 血腥) must be replaced
- Replacements should read naturally; no annotation needed after substitution
