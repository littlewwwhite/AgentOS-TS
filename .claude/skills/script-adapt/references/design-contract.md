# Design Contract

> Scope: `script-adapt` Phase A → Phase B  
> Primary artifact: `${PROJECT_DIR}/draft/design.json`  
> Companion artifact: `${PROJECT_DIR}/draft/catalog.json`

## Purpose

这个契约定义 `script-adapt` 里 **analysis / design** 阶段对 **writing / parse / downstream** 的稳定交接面。

核心原则：

1. `design.json` 是 **创作结构契约**
2. `catalog.json` 是 **实体权威表**
3. `ep*.md` 是 **作者表面**
4. `output/script.json` 是 **机器主契约**

也就是说：

- `design.json` 决定“写什么结构”
- `catalog.json` 决定“允许出现哪些人/地点/道具/状态”
- `ep*.md` 决定“怎样把结构写成场记文本”
- `script.json` 决定“下游机器如何消费”

## Ownership

| Artifact | Owner role | Editable | Meaning |
| --- | --- | --- | --- |
| `draft/design.json` | writer | yes | 剧本设计与分集结构 |
| `draft/catalog.json` | writer | yes | 角色/地点/道具/状态权威表 |
| `draft/episodes/ep*.md` | writer | yes | 写作展开层 |
| `output/script.json` | writer | guarded | 结构化主契约 |

## Required Meaning of `design.json`

`design.json` 必须只承载以下信息：

1. **title**：项目标题
2. **worldview**：世界观与核心冲突说明
3. **style**：整体视觉风格方向
4. **bilingual**：双语输出开关
5. **total_episodes**：总集数
6. **episodes[]**：逐集结构锚点

`episodes[]` 中每一项至少定义：

- `episode`
- `title`
- `main_plot`
- `climax`
- `cliffhanger`
- `scenes[]`

`scenes[]` 中每一项至少定义：

- `id`
- `time`
- `setting`
- `location`
- `description`

## What Writing May Rely On

Phase B 只允许把以下字段当成稳定输入：

- `title`
- `worldview`
- `style`
- `bilingual`
- `total_episodes`
- `episodes[].episode`
- `episodes[].title`
- `episodes[].main_plot`
- `episodes[].climax`
- `episodes[].cliffhanger`
- `episodes[].scenes[].id`
- `episodes[].scenes[].time`
- `episodes[].scenes[].setting`
- `episodes[].scenes[].location`
- `episodes[].scenes[].description`

除此之外的补充字段只能视为提示信息，**不得成为隐式硬依赖**。

## What Writing Must Not Change Locally

若不修改 `design.json`，Phase B 不得自行改变：

1. 集数总量
2. 集顺序
3. 场次编号
4. 场次时空锚点
5. 本集 `main_plot / climax / cliffhanger` 的语义核心

可以展开但不可偷换的内容：

- 对白
- 微动作
- 情绪推进
- 场内调度
- 视觉细节

## Relationship to `catalog.json`

`catalog.json` 是实体与状态的唯一权威来源。

Phase B 中：

- 角色名必须来自 `catalog.json.actors[].name`
- 地点名必须来自 `catalog.json.locations[].name`
- 道具名必须来自 `catalog.json.props[].name`
- 非默认状态必须先在 `catalog.json.actors[].states` 中注册

若写作发现当前设计需要新的状态或实体，正确动作是：

1. 先回补 `catalog.json`
2. 再继续写作

而不是在剧本里偷偷创造新名称。

## Invalidation Rule

以下改动会使下游产物失效：

| Changed artifact | Must invalidate |
| --- | --- |
| `draft/design.json` | `draft/episodes/ep*.md`, `output/script.json` |
| `draft/catalog.json` | `draft/episodes/ep*.md`, `output/script.json` |

## Non-Goals

这个契约不负责定义：

- 最终 `script.json` 完整 schema
- 视频分镜结构
- 资产生成格式

这些分别由下游契约定义。
