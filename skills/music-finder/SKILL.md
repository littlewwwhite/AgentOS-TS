---
name: music-finder
description: "智能音乐风格查询助手，基于 RateYourMusic 的 5947 个音乐风格数据库，支持快速查询、智能推荐和层级探索。"
---

# Music Genre Finder

智能音乐风格查询助手，基于 RateYourMusic 的 5947 个音乐风格数据库。

## 数据结构

`${CLAUDE_SKILL_DIR}/references/` 目录下的分层数据：

| 路径 | 内容 | 数量 |
|------|------|------|
| `_index.json` | 主分类概览索引（必读） | 49 个主分类 |
| `_meta.json` | 元数据和使用说明 | — |
| `main/{genre}.json` | 每个主分类的直接子分类 | 49 个文件 |
| `detailed/{subgenre}.json` | 有孙分类的子分类详情 | 578 个文件 |

总风格数 5947：49 主分类 + 737 子分类（sub）+ 5161 孙分类及以下（sub-2/sub-3/sub-4）。

每个风格的数据字段：

```json
{
  "name": "Dark Ambient",
  "url": "https://rateyourmusic.com/genre/dark-ambient/",
  "description": "Emphasizes an ominous, gloomy, and dissonant atmosphere.",
  "level": "sub",       // main | sub | sub-2 | sub-3 | sub-4
  "parent": "Ambient"   // 父分类名称
}
```

## 核心功能

### 1. 快速查询（精确匹配）

用户指定具体风格名称时触发。

流程：读取 `_index.json` 检查是否为主分类 → 若否，在 `main/*.json` 中搜索 → 显示风格信息、描述、链接、子分类。

### 2. 智能推荐（语义匹配）

用户描述氛围/场景/情绪时触发。

流程：扫描 `_index.json` 全部主分类描述 → 关键词匹配候选主分类 → 读取对应 `main/*.json` 筛选子分类 → 返回 3-5 个推荐，附简短说明。

常见语义映射参考：

| 用户描述 | 推荐方向 |
|---------|---------|
| 深夜、放松、冥想 | Ambient, Drone, Space Ambient |
| 有活力、激烈 | Punk, Hardcore, Drum and Bass |
| 暗黑、压抑 | Dark Ambient, Black Metal, Industrial |
| 空灵、梦幻 | Dream Pop, Shoegaze, Ambient Pop |
| 电子、科技感 | Techno, IDM, Ambient Techno |
| 复古、怀旧 | Synthwave, Vaporwave, Chillwave |
| 实验、前卫 | Noise, Free Jazz, Musique Concrète |

### 3. 层级探索（树状浏览）

用户想浏览某个分类的子分类树时触发。

流程：读取 `main/{genre}.json` 列出直接子分类 → 用户进一步询问时读取 `detailed/{subgenre}.json` → 逐层展开。

### 4. 与 Suno 集成

用户要用 Suno 生成音乐但没指定风格时，主动触发推荐流程，用户选择后将风格名称传递给 suno-music-creator 的 tags 参数。

## 读取策略

渐进式加载，最小化上下文消耗：

- **必读**：`_index.json`（13KB）— 每次查询都要先读
- **精确查询**：+1 个 `main/*.json` 或 `detailed/*.json`
- **智能推荐**：+最多 3 个候选 `main/*.json`
- **层级探索**：逐层展开，用户请求才读下一层

## 输出规范

- 包含风格名称、描述、RateYourMusic 完整链接
- 非主分类时展示层级路径
- 推荐时给出 3-5 个选项，附推荐理由
- 找不到时建议用户描述特点以搜索相似风格

## 硬性约束

- 禁止凭记忆回答风格相关问题，必须从 `${CLAUDE_SKILL_DIR}/references/` 文件中读取数据
- 每次查询先读取 `_index.json`
- 单次查询最多读取 5 个文件
