# 查询意图分类法（playbook）

把灵感调研问题翻译为 MCP 查询路径。**本文件不含 SQL 全文**——SQL 模板每次现读 `resource://domain-*`，这里只给"去哪张表、什么思路"。

长半衰期结构性规则。数据快照 / 实测覆盖 / MCP 后端行为异常见 `pitfalls.md`。

---

## 路由优先级（不可跳步）

1. 先读 `resource://table-map` — 最便宜，永远先做
2. 再读对应的 `resource://domain-*` — 拿字段定义和官方模板
3. 最后才写 `query_sql` — 基于已读模板微调

跳过前两步直接拼 SQL 会高概率错字段名/表名。

---

## 1. 趋势 / 方向发现

| 意图 | 业务域 | 表 | 思路 |
|------|-------|----|-----|
| "什么题材在涨" | 番茄小说 | `dwd_novel_base_df` | 近 7 日 `rank_name LIKE 'C端-阅读榜%'` GROUP BY category，取 reader_uv_14day 均值 TOP |
| "某品类最近首秀有没有爆款" | 番茄小说 | `dwd_novel_base_df` | `rank_name='首秀' AND category=<题材>`，按 `max(reader_uv_14day)` 降序（首秀表早期快照 uv 低，均值会误导） |
| "哪些钩子最火" | 标签域 | `novel_tag_detail` / `video_tag_detail` | `WHERE dimension='hook'` GROUP BY tag_value ORDER BY count DESC |
| "AI 漫剧市场成色" | 抖音漫剧 | `dwd_douyin_anime_df` | 最新日 GROUP BY subtype，对比 `ai_real_*` vs `real_acting` 的 count + avg_play |

注意：**"热播榜" 不是最火小说榜**。番茄 `rank_name LIKE '%热播榜%'` 为听书向榜单，与阅读榜播放量差两个数量级。做爆款对标一律用 `C端-阅读榜%` / `C端-口碑榜%` / `C端-巅峰榜%`。具体实测数据见 `pitfalls.md §榜单陷阱`。

---

## 2. 对标 / 参考作品寻找

| 意图 | 业务域 | 表 | 思路 |
|------|-------|----|-----|
| "某细分题材爆款小说"（如都市高武/都市日常） | 番茄小说 | `dwd_novel_base_df` | `rank_name='B端-男频阅读榜-<category>'`（或女频）最新日，ORDER BY rank_num — B 端榜单 category 精分 |
| "某大类题材爆款小说"（如都市/穿越/系统） | 番茄小说 | `dwd_novel_base_df` | `rank_name LIKE 'C端-阅读榜%'`（或口碑榜/巅峰榜）最新日 + `category='<大类>'`，按 reader_uv_14day 降序 |
| "已有改编的爆款小说" | 跨域 | `dwd_novel_base_df` JOIN `app_novel_to_video_df` | `is_related_video=true` 或 `video_num > 0`，按 reader_uv_14day 降序 |
| "同钩子的对标漫剧" | 抖音/红果 | `video_tag_detail` + `video_tag_wide` | `WHERE dimension='hook' AND tag_value LIKE '%<词>%'` → JOIN `video_tag_wide` 拿 summary |
| "红果漫剧爆款" | 红果 | `dwd_video_base_df` | `rank_name='动漫-热播榜'` 最新日 ORDER BY rank_num；或 `rank_name='全部' AND genre=1004 AND play_count_hg > 阈值` |

注意：红果漫剧长尾严重，无阈值排序会把尾部淹没头部。具体阈值与长尾规模见 `pitfalls.md §查询稳健性规则` 与 `§样本强约束`。

注意：**番茄 B 端 vs C 端 category 粒度差异**（结构性规则）：

- **C 端榜单**：粗粒度，只用 `都市` / `穿越` / `系统` / `重生` 等大类——`都市高武` 在 C 端不出现
- **B 端榜单**：细粒度，才有 `都市高武` / `都市日常` / `东方仙侠` / `古风世情` 等精分
- 做**细分题材**爆款对标 → **B 端阅读榜**（rank_num=榜位，reader_uv_14day 直接带出量级）
- 做**大盘趋势**（跨题材） → C 端阅读榜 / 巅峰榜

---

## 3. 深度分析单作品

| 意图 | 业务域 | 表 | 思路 |
|------|-------|----|-----|
| "某小说的故事弧 / 世界观 / 角色" | 番茄小说 | `novel_analysis` | `WHERE book_id='<id>'`，读 `story_arc_analysis` / `worldview_analysis` / `character_profile_analysis` JSON 字段 |
| "某小说黄金三章分析" | 番茄小说 | `novel_analysis` | 同上，读 `golden_three_chapters_analysis`（**小说专属**，漫剧无此字段） |
| "某漫剧六维标签画像" | 抖音漫剧 | `video_tag_wide` | `WHERE series_id='<id>'`，读 6 个 `*_tags` Array 字段 + `summary` |
| "某小说六维标签画像" | 番茄小说 | `novel_tag_wide` | `WHERE book_id='<id>'`，同上 |

注意：部分 AI 分析字段数据为空（如 `emotion_conflict_analysis`），使用前核对 `pitfalls.md §空字段`。

注意：漫剧 AI 分析覆盖率低。查不到时的降级路径：

1. 取该漫剧的 `book_exist` / `book_id`（`dwd_video_base_df` 字段）
2. 用 `book_id` 查 `novel_analysis` 得原著深度分析
3. 若无原著则告知用户"该漫剧无深度分析样本，仅能提供标签画像"

---

## 4. 改编漏斗 / 跨域

| 意图 | 业务域 | 表 | 思路 |
|------|-------|----|-----|
| "哪些小说被改编最多次" | 跨域 | `app_novel_to_video_df` | ORDER BY video_num DESC |
| "某小说改编了哪些视频" | 跨域 | `app_novel_to_video_df` | `WHERE book_id='<id>'`，读 `playlet_names` / `ai_video_names` |
| "改编短剧的播放表现" | 跨域 | `app_novel_to_video_df` ARRAY JOIN + `dwd_video_base_df` | 参考 domain-video 模板 §6（带 ARRAY JOIN 的 SQL） |
| "某题材改编率" | 跨域 | `dwd_novel_base_df` + `app_novel_to_video_df` | GROUP BY category，countIf(book_exist=true) / count() |

注意：`app_novel_to_video_df` 字段名与直觉不同（无 `adapted`，实际为 `video_num` / `playlet_num` / `ai_video_num`），且存在行级重复 / 只收录有改编的书 / 与 `dwd_novel_base_df` 存在字段类型差异——这几类坑见 `pitfalls.md §已知数据异常`。

---

## 5. 首秀 / 新书动能

| 意图 | 业务域 | 表 | 思路 |
|------|-------|----|-----|
| "最新首秀小说" | 番茄小说 | `dwd_novel_base_df` | `rank_name='首秀'` 最新日，按 reader_uv_14day 降序 |
| "某书首秀 21 天轨迹" | 番茄小说 | `dwd_novel_base_df` | `WHERE book_id='<id>' AND rank_name='首秀'`，按 release_date 升序（`on_rank_days` 最大 21） |
| "本月首秀冠军" | 番茄小说 | `dwd_novel_base_df` | `rank_name='首秀' AND release_date >= date_trunc('month', today())` GROUP BY book_id MAX(reader_uv_14day) |

首秀机制：新书上榜后连续观测 21 天，每日一条快照，`on_rank_days` 从 1 涨到 20，`word_increment` / `read_increment` 反映首秀期动能。

---

## 边界：本 MCP 不能做什么

- 用户评论 / 弹幕 / 观看行为明细（无此类表）
- 实时数据（最小粒度是日）
- 海外平台数据（ReelShort / DramaBox 等）
- 原始文本全文（小说正文 / 剧本 / 台词）

遇到以上问题直接告知用户 MCP 能力边界，**不要编造**。
