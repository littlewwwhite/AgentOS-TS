# Phase 3：结构解析

## 概述

Phase 3 是**纯确定性解析**，不需要 LLM。调用 `mcp__script__parse_script` 工具，从 `draft/episodes/*.md` 中提取结构化剧本数据。

## 输入

- `draft/episodes/ep*.md`：所有集的场记格式剧本
- `draft/catalog.json`：资产清单（用于角色和地点 ID 映射，以及状态验证）
  - 解析器使用 `catalog.actors[*].states` 验证剧本中的状态标注是否合法
  - 如果剧本中出现 catalog 未定义的状态，解析器会输出警告（但不中断解析）
- `draft/design.json`：设计文件（用于读取 title / style / worldview）

## 输出

一个 JSON 文件，写入 `output/` 目录：

### script.json

结构化剧本，嵌套 episodes > scenes > actions。解析器从 `draft/catalog.json` 映射角色名/地点名到已有 ID，未在 catalog 中的角色/地点/道具自动生成新 ID。

```json
{
  "title": "从 design.json 读取",
  "worldview": "从 design.json 读取，可为 null",
  "style": "从 design.json 读取，可为 null",
  "actors": [
    {
      "id": "act_001", "name": "楚凡",
      "states": [{"id": "st_001", "name": "幼年"}]
    },
    {"id": "act_002", "name": "林雪"}
  ],
  "locations": [
    {
      "id": "loc_001", "name": "觉醒大厅",
      "states": [{"id": "lst_001", "name": "废墟"}]
    },
    {"id": "loc_002", "name": "学院街道"}
  ],
  "props": [
    {"id": "prp_001", "name": "断剑"},
    {"id": "prp_002", "name": "玉佩"}
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
            {"actor_id": "act_001", "state_id": "st_001"},
            {"actor_id": "act_002", "state_id": null}
          ],
          "prop_ids": ["prp_001"],
          "location_state_id": "lst_001",
          "actions": [
            {"sequence": 1, "type": "sfx", "content": "异能觉醒时代"},
            {"sequence": 2, "type": "action", "content": "聚光灯下，巨大的能量水晶闪烁着耀眼的光芒。"},
            {"sequence": 3, "type": "dialogue", "actor_id": "act_002", "content": "恭喜林雪同学，觉醒A级异能！", "emotion": "高声宣布"},
            {"sequence": 4, "type": "inner_thought", "actor_id": "act_001", "content": "一夜之间，什么都没了……"}
          ]
        }
      ]
    }
  ],
  "metadata": {}
}
```

**结构说明**：
- `title` / `worldview` / `style`：从 `draft/design.json` 读取，`worldview` 和 `style` 可为 `null`
- `actors`：角色列表（`act_` 前缀 ID + name），优先使用 catalog.json 中的 ID
- `actors[*].states`：可选，角色状态数组 `[{id: "st_NNN", name}]`，仅当剧本中出现状态标注时才有此字段
- `locations`：地点列表（`loc_` 前缀 ID + name），优先使用 catalog.json 中的 ID
- `locations[*].states`：可选，地点状态数组 `[{id: "lst_NNN", name}]`，仅当场景头标注了地点状态时才有此字段
- `props`：道具列表（`prp_` 前缀 ID + name），从剧本 `道具：` 行提取
- `episodes`：按集嵌套，每集包含 scenes
- `scenes[*].cast`：该场出场角色数组 `[{actor_id, state_id}]`，`state_id` 为 `null` 表示默认状态
- `scenes[*].prop_ids`：该场涉及道具 ID 列表
- `scenes[*].location_state_id`：可选，该场地点状态 ID（如 `"lst_001"`），仅当场景头有【状态】标注时才有
- `actions.type`：action | dialogue | inner_thought | sfx
- ID 前缀规则：角色 `act_`，地点 `loc_`，道具 `prp_`，场景 `scn_`，角色状态 `st_`，地点状态 `lst_`
- 排除群演描述（"同学若干""路人×3""众人"等匹配 `×N / 若干 / 众人 / 们` 模式的名称）

## 执行

Phase 2 完成后，直接调用工具：

```
mcp__script__parse_script(project_path="{project_path}")
```

- `{project_path}`：项目工作区的**完整绝对路径**（如 `/Users/xxx/workspace/傻子`）
- 解析器自动从 `{project_path}/draft/` 读取输入，写入 `{project_path}/output/script.json`

工具返回解析统计（场景数、角色数、地点数、集数、解析文件数），确认无误后 NTS 流水线完成。

## 反降级约束

Phase 3 是**纯工具阶段**，LLM **严禁**手写或手动拼装 script.json。

- 必须且仅通过 `mcp__script__parse_script` 生成 script.json
- 如果工具调用失败，**不得降级为 LLM 读取源码/手写 JSON**，应报告错误并引导用户排查

**失败排查清单**：
1. 确认 `project_path` 是正确的项目绝对路径
2. 确认 `{project_path}/draft/episodes/` 下存在至少一个 `ep*.md` 文件
3. 确认 `{project_path}/draft/catalog.json` 存在
4. 检查工具错误信息中的具体路径是否正确
