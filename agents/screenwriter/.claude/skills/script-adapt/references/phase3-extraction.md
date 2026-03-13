# Phase 3：结构解析

## 概述

Phase 3 是**纯确定性解析**，不需要 LLM。调用 `python3 ${CLAUDE_SKILL_DIR}/scripts/parse_script.py` 脚本，从 `draft/episodes/*.md` 中提取结构化剧本数据。

## 输入

- `draft/episodes/ep*.md`：所有集的场记格式剧本
- `draft/catalog.json`：资产清单（用于角色和地点 ID 映射，以及状态验证）
  - catalog 中的 `id` 字段可选——省略时解析器按数组顺序自动分配（`act_001`, `loc_001`, `prp_001`...）
  - 解析器使用 `catalog.actors[*].states` 验证剧本中的状态标注是否合法
  - 如果剧本中出现 catalog 未定义的状态，解析器会输出警告（但不中断解析）
- `draft/design.json`：设计文件（用于读取 title / style / worldview）

## 输出

一个 JSON 文件，写入 `output/` 目录：

### script.json

结构化剧本，嵌套 episodes > scenes > actions。解析器从 `draft/catalog.json` 映射角色名/地点名到已有 ID（支持 `aliases` 别名匹配）。有 catalog 时采用 catalog-only 模式：未在 catalog 中注册的角色/地点/道具**不会**自动生成 ID，而是产出 `warnings` 数组；无 catalog 时才回退为自动生成 ID。

```json
{
  "title": "从 design.json 读取",
  "worldview": "从 design.json 读取，可为 null",
  "style": "从 design.json 读取，可为 null",
  "actors": [
    {
      "actor_id": "act_001", "actor_name": "楚凡",
      "description": "20岁，男，废柴觉醒者；外表沉默内心不甘",
      "states": [{"state_id": "st_001", "state_name": "战甲", "description": "银色鎏金重甲，肩甲雕龙纹"}]
    },
    {"actor_id": "act_002", "actor_name": "林雪"}
  ],
  "locations": [
    {
      "location_id": "loc_001", "location_name": "觉醒大厅",
      "description": "宏大的圆形测试场，穹顶悬浮水晶",
      "states": [{"state_id": "st_002", "state_name": "废墟", "description": "半面墙体坍塌，碎砖瓦砾"}]
    },
    {"location_id": "loc_002", "location_name": "学院街道"}
  ],
  "props": [
    {"prop_id": "prp_001", "prop_name": "断剑", "description": "锈迹斑斑的古剑，剑身断裂"},
    {"prop_id": "prp_002", "prop_name": "凡字玉佩"}
  ],
  "episodes": [
    {
      "episode_id": "ep_001",
      "title": null,
      "scenes": [
        {
          "scene_id": "scn_001",
          "environment": {"space": "interior", "time": "day"},
          "locations": [{"location_id": "loc_001", "state_id": "st_002"}],
          "actors": [
            {"actor_id": "act_001", "state_id": "st_001"},
            {"actor_id": "act_002", "state_id": null}
          ],
          "props": [{"prop_id": "prp_002", "state_id": null}],
          "actions": [
            {"type": "sfx", "content": "异能觉醒时代"},
            {"type": "action", "content": "聚光灯下，巨大的能量水晶闪烁着耀眼的光芒。"},
            {"type": "dialogue", "actor_id": "act_002", "content": "恭喜林雪同学，觉醒A级异能！", "emotion": "高声宣布"},
            {"type": "inner_thought", "actor_id": "act_001", "content": "一夜之间，什么都没了……"}
          ]
        }
      ]
    }
  ]
}
```

**结构说明**：
- `title` / `worldview` / `style`：从 `draft/design.json` 读取，`worldview` 和 `style` 可为 `null`
- `actors`：角色列表，字段为 `actor_id`（`act_` 前缀）+ `actor_name` + 可选 `description`（从 catalog 透传）
- `actors[*].states`：可选，角色状态数组 `[{state_id, state_name, description?}]`，仅当剧本中出现状态标注时才有此字段
- `locations`：地点列表，字段为 `location_id`（`loc_` 前缀）+ `location_name` + 可选 `description`
- `locations[*].states`：可选，地点状态数组 `[{state_id, state_name, description?}]`
- `props`：道具列表，字段为 `prop_id`（`prp_` 前缀）+ `prop_name` + 可选 `description`，从剧本 `道具：` 行提取
- `episodes`：按集嵌套，`episode_id` 格式为 `ep_001`，`title` 可为 `null`
- `scenes[*].scene_id`：格式为 `scn_{NNN}`（如 `scn_001`），全局递增
- `scenes[*].environment`：`{space: "interior"|"exterior", time: "day"|"night"}`（中文自动翻译为英文：内→interior，外→exterior，日→day，夜→night）
- `scenes[*].locations`：该场地点数组 `[{location_id, state_id}]`，`state_id` 为 `null` 表示默认状态
- `scenes[*].actors`：该场出场角色数组 `[{actor_id, state_id}]`，`state_id` 为 `null` 表示默认状态
- `scenes[*].props`：该场涉及道具数组 `[{prop_id, state_id}]`，`state_id` 始终为 `null`（parser 不从剧本解析道具状态）
- `actions[*].type`：`action` | `dialogue` | `inner_thought` | `sfx`
- `actions[*]` dialogue/inner_thought 额外字段：`actor_id`；dialogue 还有 `emotion`（可选）
- ID 前缀规则：角色 `act_`，地点 `loc_`，道具 `prp_`，场景 `scn_`，状态 `st_`（角色和地点共享同一状态计数器），编号均为三位数零填充（如 `act_001`）
- 排除群演描述（"同学若干""路人×3""众人"等匹配 `×N / 若干 / 众人 / 们` 模式的名称）

## 执行

Phase 2 完成后，直接调用工具：

```
python3 ${CLAUDE_SKILL_DIR}/scripts/parse_script.py --project-path "{project_path}"
```

- `{project_path}`：项目工作区的**完整绝对路径**（如 `/Users/xxx/workspace/傻子`）
- 解析器自动从 `{project_path}/draft/` 读取输入，写入 `{project_path}/output/script.json`

工具返回解析统计（场景数、角色数、地点数、集数、解析文件数），确认无误后 NTS 流水线完成。

## 反降级约束

Phase 3 是**纯工具阶段**，LLM **严禁**手写或手动拼装 script.json。

- 必须且仅通过 `python3 ${CLAUDE_SKILL_DIR}/scripts/parse_script.py` 生成 script.json
- 如果工具调用失败，**不得降级为 LLM 读取源码/手写 JSON**，应报告错误并引导用户排查

**失败排查清单**：
1. 确认 `project_path` 是正确的项目绝对路径
2. 确认 `{project_path}/draft/episodes/` 下存在至少一个 `ep*.md` 文件
3. 确认 `{project_path}/draft/catalog.json` 存在
4. 检查工具错误信息中的具体路径是否正确
