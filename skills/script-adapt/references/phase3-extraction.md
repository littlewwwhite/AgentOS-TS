# Phase 3：结构解析

## 概述

Phase 3 是**纯确定性解析**，不需要 LLM。调用 `mcp__script__parse_script` 工具，从 episodes/*.md 中提取结构化剧本数据。

道具提取不在 NTS 范围内，由下游 asset skill 处理。

## 输入

- `episodes/ep*.md`：所有集的场记格式剧本
- `catalog.json`：资产清单（用于角色和地点 ID 映射，以及状态验证）
  - 解析器使用 `catalog.actors[*].states` 验证剧本中的状态标注是否合法
  - 如果剧本中出现 catalog 未定义的状态，解析器应报错或警告

## 输出

一个 JSON 文件，写入工作区根目录：

### script.json

结构化剧本，嵌套 episodes > scenes > actions。解析器会从 catalog.json 映射角色名和地点名到已有 ID，未在 catalog 中的角色/地点自动生成新 ID。

```json
{
  "title": "从 design.json 读取",
  "worldview": "从 design.json 读取（可为 null）",
  "style": "从 design.json 读取（可为 null）",
  "actors": [
    {"id": "act_001", "name": "楚凡", "states": [{"id": "st_001", "name": "幼年"}]},
    {"id": "act_002", "name": "林雪"}
  ],
  "locations": [
    {"id": "loc_001", "name": "觉醒大厅"},
    {"id": "loc_002", "name": "学院街道"}
  ],
  "props": [
    {"id": "prp_001", "name": "玉佩"}
  ],
  "episodes": [
    {
      "episode": 1,
      "title": "觉醒",
      "scenes": [
        {
          "id": "scn_001",
          "sequence": 1,
          "location": "觉醒大厅",
          "location_id": "loc_001",
          "time_of_day": "day",
          "cast": [
            {"actor_id": "act_001", "state_id": null},
            {"actor_id": "act_002", "state_id": null}
          ],
          "prop_ids": ["prp_001"],
          "actions": [
            {"sequence": 1, "type": "sfx", "content": "异能觉醒时代"},
            {"sequence": 2, "type": "action", "content": "聚光灯下，巨大的能量水晶闪烁着耀眼的光芒。"},
            {"sequence": 3, "type": "dialogue", "actor_id": "act_002", "content": "恭喜林雪同学，觉醒A级异能！", "emotion": "高声宣布"},
            {"sequence": 4, "type": "inner_thought", "actor_id": "act_001", "content": "一夜之间，什么都没了……"}
          ]
        },
        {
          "id": "scn_002",
          "sequence": 2,
          "location": "学院街道",
          "location_id": "loc_002",
          "time_of_day": "night",
          "cast": [
            {"actor_id": "act_001", "state_id": null}
          ],
          "prop_ids": [],
          "actions": []
        }
      ]
    }
  ],
  "metadata": {}
}
```

**结构说明**：
- `worldview`：从 design.json 读取的世界观描述（可为 null）
- `style`：从 design.json 读取的风格描述（可为 null）
- `actors`：角色列表（id + name），优先使用 catalog.json 中的 ID，ID 前缀 `act_`
- `actors[*].states`：可选，角色造型状态列表 `[{id: "st_001", name: "幼年"}]`，仅当角色有非 default 造型时存在
- `locations`：地点列表（id + name），优先使用 catalog.json 中的 ID，ID 前缀 `loc_`
- `locations[*].states`：可选，地点状态列表 `[{id: "lst_001", name: "废墟"}]`，仅当地点有状态变体时存在
- `props`：道具列表（id + name），ID 前缀 `prp_`，从剧本道具行提取
- `episodes`：按集嵌套，每集包含 scenes
- `scenes`：每场包含 location_id（映射到 catalog）和 actions
- `scenes[*].cast`：该场出演角色及其造型状态 `[{actor_id, state_id}]`，state_id 为 null 表示 default 造型
- `scenes[*].prop_ids`：该场使用的道具 ID 列表
- `scenes[*].location_state_id`：可选，地点状态 ID（如 `"lst_001"`），仅当场次头标注了地点状态时存在
- `actions.type`：action | dialogue | inner_thought | sfx | narration
- 排除群演描述（"同学若干""路人×3"）

## 执行

Phase 2 完成后，直接调用工具：

```
mcp__script__parse_script(project_path="{project_root}")
```

工具返回解析统计（场景数、角色数、地点数、集数、解析文件数），确认无误后 NTS 流水线完成。
