# Inspiration Contract

本文档定义 Pipeline Stage 0 (INSPIRATION) 的产物 `${OUTPUT}/inspiration.json` 的 schema、字段填充来源、自检清单与反模式。`wangwen` skill 以本文件为单一事实源；下游 SCRIPT 阶段以本文件为消费契约。

## Schema

```json
{
  "core_concept": "核心创意一句话描述",
  "key_elements": ["元素1", "元素2", "元素3"],
  "target_audience": "男频/女频",
  "genre": "主题材",
  "reference_works": [
    {"id": "作品ID", "name": "作品名", "reason": "参考原因"}
  ],
  "market_insights": "市场分析总结",
  "trend_analysis": "当前趋势概述",
  "suggested_setting": "建议的世界观/背景设定",
  "actor_archetypes": ["角色原型1", "角色原型2"]
}
```

## 字段填充来源

每个字段必须明确区分**数据支撑**、**AI 归纳**、**数据+AI**三种来源，**不得混淆**——数据和归纳不能糊成一个模糊陈述。下游 SCRIPT 阶段依据此分类决定是否允许改写。

| 字段 | 类型 | 填充方式 |
|------|------|---------|
| `core_concept` | AI 归纳 | 综合用户输入 + 对标作品 `summary` / `core_tags_analysis` 提炼一句话。禁止"震撼"、"前所未有"等无数据支撑的夸张词 |
| `key_elements` | 数据支撑 | 对标作品 `hook_tags` / `vibe_tags` / `gold_finger_tags` 聚合高频值（至少 3 部对标作品出现过的标签优先） |
| `target_audience` | 数据支撑 | 对标作品 `gender` / `audience` 字段（番茄 `dwd_novel_base_df.gender` 是字符串，红果 `dwd_video_base_df.gender` 是 Bool，不要混） |
| `genre` | 数据支撑 | 番茄用 `category`（如"都市高武"/"穿越"/"东方仙侠"），漫剧用 `genre`（1=短剧/1004=漫剧）或 tag 表 `genre` |
| `reference_works[]` | 数据支撑 | 查询结果的真实 `book_id`/`series_id` + 真实名字；`reason` 字段**必须包含具体数值**（播放/在读/排名/首秀天数等） |
| `market_insights` | 数据+AI | 聚合查询得"事实陈述" + AI 做"判断"；事实与判断分开写 |
| `trend_analysis` | 数据+AI | 近 7 日 vs 近 30 日对比数据 + AI 解读；至少引用一条具体对比数值 |
| `suggested_setting` | AI 归纳 | 基于 `worldview_analysis` JSON 和 `world_tags` Array 归纳；允许 AI 加工但要注明参考源 |
| `actor_archetypes` | 数据+AI | 从对标作品 `character_profile_analysis` JSON + `identity_tags` Array 提取，AI 去重/归类 |

## 写入前自检清单（硬门控）

写 `${OUTPUT}/inspiration.json` 前逐项检查：

- [ ] 每个 `reference_works[].id` / `.name` 来自**真实查询结果**，未编造
- [ ] 每个 `reference_works[].reason` **包含具体字段+数值**（如 "reader_uv_14day=77 万"），不是"很火"这种空话
- [ ] `target_audience` / `genre` 有明确字段依据，而不是 AI 凭经验猜的
- [ ] `market_insights` / `trend_analysis` 的**每个陈述能被至少一条 SQL 复现**
- [ ] 标注为"AI 归纳"的字段没有伪装成数据支撑（避免"数据显示" + 实际无数据）
- [ ] 未使用已知空字段（核对 `.claude/skills/wangwen/references/pitfalls.md`）

任一项不通过 → 回到查询补数据，不得降级为"经验判断"蒙混。

## 反模式（对照避免）

**A. 编造作品**

反例：`{"name": "某爆款短剧", "reason": "据说在抖音很火"}`

正例：`{"id": "7449122883281256234", "name": "男人五十岁", "reason": "抖音漫剧日榜第 1，play_count=1.77 亿，play_inc=1.09 亿（2026-04-17 日榜快照）"}`

**B. 空洞市场判断**

反例：`"market_insights": "市场前景广阔，题材空间大"`

正例：`"market_insights": "2026-04-17 番茄 B端-男频阅读榜-都市高武 TOP15 reader_uv_14day 中位数 ≈70 万，TOP1《我不是戏神》402 万；TOP15 中 9 部已改编（is_related_video=1），TOP3 改编的 3 部全为 AI 漫剧路径（ai_video_num≥1 / playlet_num=0），真人短剧路径在该题材缺席——说明漫剧改编窗口仍活跃且供给侧倾向 AI 漫剧。"`

**C. 数据+归纳混说**

反例：`"trend_analysis": "重生复仇类作品非常受欢迎"`

正例：`"trend_analysis": "hook=重生复仇 在漫剧六维标签中覆盖 165 部独立作品（video_tag_detail 2026-04-17 快照），为 hook 维度第 2 大 cluster；结合番茄同 hook 改编率 68%（示例数值），判断该方向改编链路通畅。"`

事实 / 依据 / 推断三层分开，不模糊。

## 下游契约

`inspiration.json` 由下游 SCRIPT 阶段（`script-writer` 或未来迁入的 `idea-to-script`）消费为创作起点。"数据支撑"字段不得擅改；"AI 归纳"字段允许下游重写；"数据+AI"字段的事实部分不得擅改、判断部分允许重写。**契约字段以本文件为准**——skill 内部文档（SKILL.md / references）不得重复 schema 定义，避免漂移。
