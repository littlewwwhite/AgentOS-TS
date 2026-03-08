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

结构化剧本，嵌套 episodes > scenes > actions。解析器会从 catalog.json 映射角色名和地点名到已有 ID，未在 catalog 中的角色/地点自动生成新 ID。解析完成后计算反向索引：每个角色/地点出现在哪些场。

```json
{
  "title": "从 design.json 读取",
  "actors": [
    {"id": "chr_001", "name": "楚凡", "scene_ids": ["scn_001", "scn_002", "scn_005"], "states": {"default": ["scn_001", "scn_005"], "幼年": ["scn_002"]}},
    {"id": "chr_002", "name": "林雪", "scene_ids": ["scn_001"], "states": {"default": ["scn_001"]}}
  ],
  "locations": [
    {"id": "loc_001", "name": "觉醒大厅", "scene_ids": ["scn_001"]},
    {"id": "loc_002", "name": "学院街道", "scene_ids": ["scn_002"]}
  ],
  "props": [],
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
          "actor_ids": ["chr_001", "chr_002"],
          "actor_states": {},
          "actions": [
            {"sequence": 1, "type": "sfx", "content": "异能觉醒时代"},
            {"sequence": 2, "type": "action", "content": "聚光灯下，巨大的能量水晶闪烁着耀眼的光芒。"},
            {"sequence": 3, "type": "dialogue", "actor_id": "chr_002", "content": "恭喜林雪同学，觉醒A级异能！", "emotion": "高声宣布"},
            {"sequence": 4, "type": "inner_thought", "actor_id": "chr_001", "content": "一夜之间，什么都没了……"}
          ]
        }
      ]
    }
  ],
  "metadata": {}
}
```

**结构说明**：
- `actors`：角色列表（id + name + scene_ids + states），优先使用 catalog.json 中的 ID
- `actors[*].scene_ids`：该角色出现的所有场景 ID
- `actors[*].states`：角色-状态-场景映射（如 `{"default": ["scn_001"], "幼年": ["scn_002"]}`），asset_gen 用来确定需要生成几套素材
- `locations`：地点列表（id + name + scene_ids），优先使用 catalog.json 中的 ID
- `locations[*].scene_ids`：使用该地点的所有场景 ID
- `episodes`：按集嵌套，每集包含 scenes
- `scenes`：每场包含 location_id（映射到 catalog）和 actions
- `scenes[*].actor_states`：场景维度的角色状态（如 `{"chr_001": "幼年"}`），仅记录非 default 状态，Producer 用来确定某场使用哪个素材变体
- `actions.type`：action | dialogue | inner_thought | sfx | narration
- 道具：不做映射（由下游 LLM 从 action 文本推断）
- 排除群演描述（"同学若干""路人×3"）

## 执行

Phase 2 完成后，直接调用工具：

```
mcp__script__parse_script(project_path="{project_root}")
```

工具返回解析统计（场景数、角色数、地点数、集数、解析文件数），确认无误后 NTS 流水线完成。
