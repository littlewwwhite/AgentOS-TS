# 实测红线 / 字段可用性（pitfalls）

**基础快照：2026-04-17**。短半衰期文件——数据覆盖、空字段、MCP 行为、数据规模会随 MCP 升级或数据增长而变化。发现偏差请更新对应条目并重标实测日期，**不要沉默**。

长期结构性规则（意图→表→思路、榜单类别选择、B/C 端粒度）见 `playbook.md`。

---

## 空字段（schema 有 / 数据空）

| 字段 | 表 | 实测状态 | skill 处理 |
|------|----|--------|----------|
| `emotion_conflict_analysis` | `wangwen_bigdata.novel_analysis` | 样本三条全为空字符串（length=0） | **不得宣称提供情感冲突分析能力**；用户问时明确说明"该字段数据暂未开放" |
| `emotion_conflict_analysis` | `wangwen_bigdata.video_analysis` | 同上 | 同上 |

遇到新的空字段请补入本表。

---

## 样本强约束（数据存在但覆盖有限）

| 数据源 | 实测覆盖 | 必须的降级路径 |
|-------|---------|-------------|
| 漫剧 AI 深度分析（`video_analysis` / `video_tag_wide`） | 仅 4,379 部，占红果漫剧全量 26.5 万 ≈ **1.6%** | 查不到时：用 `dwd_video_base_df.book_exist=true` 拿 `book_id` → 查 `novel_analysis` 得原著深度分析 |
| 红果漫剧全量快照 | `rank_name='全部' AND genre=1004` 共 **264,974** 条，均 `play_count_hg`≈2.5 万（对比真人短剧均 24.7 万） | 见下节 §查询稳健性规则 第 3 条"长尾表阈值" |
| 抖音漫剧 subtype 中 `ai_real_acting` | 仅 4,438 条（vs `ai_real_narration` 53,754 条） | 查 AI 真人剧对标时两个子类型都要纳入 |

---

## 数据规模与更新频率

| 表 | 规模 | 分区键 | 更新 |
|---|------|-------|------|
| `dw_jm.dwd_novel_base_df` | 16,845,308 | `release_date` | 每日 |
| `dw_jm.dwd_video_base_df` | 27,726,141 | `release_date` | 每日 |
| `etl.dwd_douyin_anime_df` | 14,054,304 | `dt` | 每日 |
| `etl.ads_anime_rank_official` | 38,635 | `stat_date` | 每日 |
| `wangwen_bigdata.novel_analysis` | 148,999 | 无 | 增量 |
| `wangwen_bigdata.novel_tag_detail` | 3,473,573 | 无 | 增量 |
| `wangwen_bigdata.novel_tag_wide` | 144,131 | 无 | 增量 |
| `wangwen_bigdata.video_analysis` | 4,379 | 无 | 增量 |
| `wangwen_bigdata.video_tag_detail` | 90,853 | 无 | 增量 |
| `wangwen_bigdata.video_tag_wide` | 4,379 | 无 | 增量 |
| `dw_jm.app_novel_to_video_df` | 42,370 | 无 | 定期 |

数据最新日期以查询时实测为准（`SELECT max(<partition_key>) FROM <table>` 现查）。

---

## 查询稳健性规则

### 必须遵守

1. **分区键必填**：`stat_date` / `dt` / `release_date` 不加会全表扫超时
2. **LIMIT 必加**（MCP 默认 100，主动指定更可控）
3. **长尾表阈值**：`dwd_video_base_df` 漫剧查询加 `play_count_hg > 100000` 或 `heat_value_hg > 10000000`，否则排序结果基本是尾部 1-10 播的噪音覆盖头部

### 强烈建议

4. **JSON 字段试跑先行**：`core_tags_analysis` 等 JSON 字段结构无官方 schema，使用 `JSONExtractString(field, 'key')` 前先 `SELECT field FROM ... LIMIT 1` 看一条真实 JSON
5. **Array 字段语法**：`has(tags, '穿越')` 或 `arrayExists(x -> x LIKE '%<词>%', tags)`
6. **跨表字段类型差异**：`app_novel_to_video_df.tags` 是 `String`、`gender` 是 `Bool`，与 `dwd_novel_base_df` 的 `Array(String)` / `String` 不同——JOIN 时先类型对齐
7. **`update_status` 陷阱**：在 `dwd_novel_base_df` 是字符串 `'true'`/`'false'`，条件写 `= 'true'` 而不是 `= true`

---

## 榜单陷阱（番茄小说）

`rank_name LIKE '%热播榜%'` 为**听书向**榜单，与阅读榜量级差两个数量级：

| 榜单 | 粒度 | 实测均值（都市高武，2026-04-17） |
|-----|------|--------------|
| `C端-热播榜-都市高武` | 样本仅 3 条 | avg `reader_uv_14day` ≈ **1.3 万** |
| `C端-阅读榜`（同题材口径） | 正常 | avg `reader_uv_14day` ≈ **117 万** |

做爆款对标一律用 `C端-阅读榜%` / `C端-口碑榜%` / `C端-巅峰榜%`；B/C 端粒度差异见 `playbook.md §2`。

---

## 已知数据异常（非 bug，但影响 skill 表达）

- **`app_novel_to_video_df` 只存有改编记录的书**（实测 42,370 条，均 `video_num ≥ 1`）。做"改编率"时分母**不能**取 `count(dwd_novel_base_df)` 全量，而需"有改编 / 有该 category 的书总数"两路各自聚合再除
- **`app_novel_to_video_df` 无 `adapted` 字段**（2026-04-17 实测），实际字段：`video_num` / `playlet_num`（真人短剧数） / `ai_video_num`（漫剧数） + `video_ids` / `playlet_ids` / `ai_video_ids` / `*_names`
- **`app_novel_to_video_df` 行级重复**（同一 book_id 多行字段一致）：使用时需 `DISTINCT book_id, ...` 或按 `argMax(ctime)` 去重，否则 JOIN 后放大
- **漫剧 subtype 存在空字符串类**（实测 18,941 条）：归为"未分类"处理
- **番茄首秀 TOP 在某些日期全为男频**：不是 bug，是数据本身分布；查女频首秀需显式加 `gender='女频'`
- **`novel_tag_wide.book_name` 可能与 `dwd_novel_base_df.book_name` 不一致**（书改名 / 两表同步延迟，实测案例：book_id=7504849932138859545 在 novel_base=《时停起手，邪神也得给我跪下！》、在 tag_wide=《时间归0，唯我独行》）。规范书名以 `dwd_novel_base_df` 最新日为准

---

## MCP 后端行为约束（查询失败的非直观原因）

1. **表白名单**：MCP `query_sql` 仅允许上表列出的 11 张业务表，查 `system.*` 或其他库会报明确"不在白名单"错误（可直接定位）
2. **字段/列名错误 触发"内部错误"**（不是"字段不存在"）：2026-04-17 实测，在 `app_novel_to_video_df` 里 `SELECT adapted` 会返回"query_sql 内部错误，请稍后重试或缩小查询范围"，而非 `Unknown identifier: adapted`——字段拼错与真正超时不易区分。建议先 `SELECT * FROM <table> LIMIT 1` 验证字段后再写业务 SQL
3. **LIMIT 自动注入**：顶层 SELECT 会被注入 LIMIT（默认 100，也可显式指定）。标量子查询（`WHERE x = (SELECT max(...) ...)`）实测正常工作；MCP 内部机制未公开，遇异常时优先怀疑字段名 / 白名单 / 资源限制
