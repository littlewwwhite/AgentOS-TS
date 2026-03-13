# Prompts 格式规范总结

## 问题回顾

之前生成的 JSON 文件使用了错误的 prompts 格式:

```json
{
  "segment_id": "SC01-L01",
  "prompts": {
    "content": "...",
    "style": "...",
    "lighting": "...",
    "sfx": "...",
    "music_allowed": false
  }
}
```

## 正确格式

根据 SKILL.md v2.31.0 规范,正确格式应该是:

```json
{
  "segment_id": "SC01-L01",
  "SC01-L01_prompts": "英文提示词字符串...",
  "SC01-L01_prompts_cn": "中文提示词字符串..."
}
```

## 关键要点

1. ✅ **字段命名**: 必须使用 `{segment_id}_prompts` 和 `{segment_id}_prompts_cn`
2. ✅ **字段类型**: 必须是**字符串**,不能是对象
3. ✅ **字段数量**: 每个 segment 必须同时包含英文和中文两个 prompts 字段
4. ✅ **字段顺序**: 英文 prompts 在前,中文 prompts_cn 在后
5. ✅ **人物一致性前缀**: 两个 prompts 字段都必须以人物一致性前缀开头
6. ✅ **时间格式**: 英文版使用连字符 `-` (如 `0-3s`),中文版使用 en dash `–` (如 `0–3s`)

## 完整示例

```json
{
  "segment_id": "SC01-L01",
  "source_beat": "1-1 日 内 皇宫大殿·选秀",
  "duration_seconds": "15s",
  "characters": ["萧禾", "娘亲"],
  "scene": "回府马车内",
  "time": "日",
  "weather": "晴",
  "props": ["马车", "车窗"],
  "emotion": "困惑→娘亲骄傲→萧禾疑虑",
  "core_conflict": "萧禾开始怀疑爹爹说的是\"舞\"还是\"武\"",
  "shots": [...],
  "SC01-L01_prompts": "Maintain characters exactly as reference images, 100% identical facial features, same bone structure, eye spacing and jaw geometry, no beautification, no age changes. 0-3s, standard medium shot...",
  "SC01-L01_prompts_cn": "保持人物与参考图完全一致,面部特征100%相同,保持相同的骨骼结构、眼距和下颚几何形状,禁止美化,禁止改变年龄。0–3s,标准中景..."
}
```

## 检查清单

### A. Segment 级别检查

- [ ] A6: prompts 字段命名正确 (`{segment_id}_prompts` 和 `{segment_id}_prompts_cn`)
- [ ] A8: prompts 字段类型为字符串
- [ ] A9: 同时包含英文和中文两个 prompts 字段
- [ ] A10: 包含人物一致性前缀
- [ ] A11: 时间范围格式正确
- [ ] **A12: props 字段不包含场景固有元素**

### C. Prompts 级别检查

- [ ] C0: prompts 字段格式为字符串,不是对象
- [ ] C1: 包含人物一致性前缀
- [ ] C2: 英文版使用连字符 `-`
- [ ] C3: 中文版使用 en dash `–`
- [ ] C4: 中文版禁止场景转换标记
- [ ] C9: 字段命名正确
- [ ] C10: 两个 prompts 字段都存在

## Props 字段规则

### 禁止写入 props 的内容

- ❌ 建筑结构：门、窗、墙、柱、廊、梁、门槛等
- ❌ 场所家具：床、桌、椅、红木家具、屏风、地板、床榻等
- ❌ 交通工具本体：马车（当 scene 为马车内时）、轮椅（当角色坐轮椅时）
- ❌ 光影效果：烛火、灯火、阴影、光斑等
- ❌ 床上用品：被子、枕头、锦被、褥子等
- ❌ 其他固有元素：地砖、石板、台阶、粗布等

### 应该写入 props 的内容

- ✅ 角色专门携带的道具：手帕、佩刀、官服、名册、令牌、礼品等
- ✅ 角色专门使用的物品：内丹、药瓶、信件等
- ✅ 因角色特殊状态而存在的辅助工具：**轮椅**（因残疾）、拐杖、眼镜等

### 判断标准

**该物品是否因场景或人物身份而自然存在？**
- 若是（如寝宫的床、大殿的柱子）→ 不写入 props
- 若否（如角色专门带来、使用，或因角色特殊状态而存在）→ 写入 props

**关键区别：**
- 床、桌、椅 → 场景固有家具（任何房间都可能有）→ ❌ 不写入
- 轮椅 → 因白行风残疾而存在的辅助工具 → ✅ 写入

### 示例

```json
// ✅ 正确
{
  "scene": "灵霜寝宫",
  "props": []  // 床榻、锦被、烛火都是寝宫固有元素
}

// ✅ 正确
{
  "scene": "灵霜寝宫",
  "props": ["内丹"]  // 内丹是白行风专门取出的道具
}

// ❌ 错误
{
  "scene": "灵霜寝宫",
  "props": ["红木雕花床榻", "锦被", "烛火"]  // 这些都是场景固有元素
}
```

## 自动检查工具

### 1. 综合检查（推荐）

同时检查 prompts 和 props 字段:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/check_all.py <json_file>
```

### 2. 单独检查 Prompts 格式

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/check_prompts_format.py <json_file>
```

### 3. 单独检查 Props 字段

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/check_props_field.py <json_file>
```

## 更新记录

- **v2.32.0 (2026-03-05)**:
  - 新增 props 字段检查规则和示例
  - 创建 props 字段检查脚本 (`check_props_field.py`)
  - 创建综合检查脚本 (`check_all.py`)
  - 修正 ep01_shots.json 中的 props 字段错误
- **v2.31.0 (2026-03-05)**:
  - 修正 prompts 格式规范,添加完整示例和检查工具
- **文件位置**: `${CLAUDE_SKILL_DIR}/SKILL.md`
- **检查脚本目录**: `${CLAUDE_SKILL_DIR}/scripts/`
