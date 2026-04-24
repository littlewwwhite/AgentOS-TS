# Outline Contract

> Scope: `design.json.episodes[]` as the canonical outline surface

## Purpose

`design.json` 里真正承担“大纲交接”职责的，不是整个文件，而是 `episodes[]`。

这个文档把 `episodes[]` 明确成一层独立契约，避免 analysis 写太多、writing 读太多、双方都在猜。

## Canonical Outline Surface

每个 `episodes[]` 条目必须回答五个问题：

1. **这一集讲什么** → `main_plot`
2. **这一集最炸的点是什么** → `climax`
3. **这一集最后用什么钩住下一集** → `cliffhanger`
4. **这一集由哪些场组成** → `scenes[]`
5. **这些场的时空锚点是什么** → `scenes[].time / setting / location`

## Required Fields

```json
{
  "episode": 1,
  "title": "集标题",
  "main_plot": "本集核心事件",
  "climax": "本集情绪或事件高潮",
  "cliffhanger": "本集结尾悬念",
  "scenes": [
    {
      "id": "1-1",
      "time": "日",
      "setting": "内",
      "location": "公司大厅",
      "description": "冲突开场"
    }
  ]
}
```

## Writing Freedom vs Writing Boundary

### Writing may decide

- 每场对白怎么说
- 动作如何拆成 `▲` 行
- 情绪峰值如何在场内落点
- 如何把 `description` 展开成可拍画面

### Writing may not silently decide

- 本集核心事件换题
- 高潮位置从 A 事件偷换到 B 事件
- 集尾悬念改成另一类问题
- 场次 ID 重排
- 在未修改上游大纲的情况下新增会改变主叙事的关键场

## Scene Granularity Rule

`scenes[]` 是**结构锚点**，不是最终镜头表。

因此：

- `scenes[]` 必须少而稳，只表达必要的时空与叙事单元
- `ep*.md` 可以在场内展开动作，不应把上游大纲变成逐镜头碎片
- 同一时空、同一戏剧目标的内容默认属于同一场

## Downstream Dependence

下游可以稳定依赖的只有：

- 集顺序
- 场次 ID
- 场次时空锚点
- `main_plot / climax / cliffhanger` 的语义角色

下游不应把以下内容当刚性契约：

- `description` 的字面措辞
- 某一句参考措辞的修辞风格

## Change Discipline

如果用户修改了以下任一项：

- `main_plot`
- `climax`
- `cliffhanger`
- `scenes[]`

则必须视为**结构层变更**，下游 `ep*.md` 与 `script.json` 都应失效重算。
