# 自动化视频重新生成使用指南

## 功能说明

当视频被判定为不合格时，自动执行以下流程：
1. 评审视频质量
2. 调用 drama-storyboard skill 优化提示词
3. 使用优化后的提示词重新生成视频

## 使用方式

### 方式1: 使用自动化脚本（推荐）

```bash
python3 scripts/auto_regenerate.py <视频路径>
```

**工作流程**：
1. 自动评审视频
2. 如果不合格，生成改进建议
3. 调用 drama-storyboard skill 优化提示词
4. 生成重新生成命令

### 方式2: 在 Claude Code 中使用

在 Claude Code 对话中直接说：

```
请评审视频 03-video/ep01/sc01/l01/ep01-sc01-l01-c01.mp4，
如果不合格，自动调用 drama-storyboard 优化提示词并重新生成
```

Claude Code 会自动执行完整流程。

## 完整示例

### 示例1: 单个视频自动重新生成

```bash
# 步骤1: 运行自动化脚本
python3 scripts/auto_regenerate.py 03-video/ep01/sc01/l01/ep01-sc01-l01-c01.mp4

# 输出:
# ============================================================
# 步骤1: 评审视频质量
# ============================================================
# 评审结果: ✗ 不合格
# 总分: 25/50
# 不合格原因:
#   - ❌ 剧情维度严重不达标: 4/10 (硬性要求 >= 5，必须重新生成)
#   - 总分过低: 25/50 (要求 >= 30)
#
# ============================================================
# 步骤2: 优化视频提示词
# ============================================================
# 调用 drama-storyboard skill 优化提示词
# 临时脚本已保存: /tmp/video_regeneration_script.txt
#
# ⚠️  需要手动操作
# 请使用 drama-storyboard skill 处理文件: /tmp/video_regeneration_script.txt

# 步骤2: 在 Claude Code 中执行
# 打开 Claude Code，输入:
/drama-storyboard /tmp/video_regeneration_script.txt

# 步骤3: 使用生成的提示词创建视频
# Claude Code 会生成优化后的提示词，然后使用 video-create 生成新视频
```

### 示例2: 批量自动重新生成

```bash
# 创建批量处理脚本
cat > batch_auto_regenerate.sh << 'EOF'
#!/bin/bash

for video in 03-video/ep01/sc01/*/*.mp4; do
    echo "处理: $video"
    python3 scripts/auto_regenerate.py "$video"
    echo "---"
done
EOF

chmod +x batch_auto_regenerate.sh
./batch_auto_regenerate.sh
```

## 在 Claude Code 中的集成使用

### 方法1: 直接对话

```
用户: 评审这个视频，如果不合格就自动重新生成
      03-video/ep01/sc01/l01/ep01-sc01-l01-c01.mp4

Claude:
1. 正在评审视频...
   ✗ 不合格 (25/50)
   - ❌ 剧情维度严重不达标: 4/10
   - 总分过低: 25/50

2. 调用 drama-storyboard 优化提示词...
   [自动调用 /drama-storyboard skill]

3. 生成优化后的提示词:
   (00-1.5s): [Slow Dolly In] + [柔和晨光透过窗帘] + [主角缓缓睁眼，眼神迷离]。
   (1.5-3.0s): [Handheld Follow] + [主角起身，衣摆随动] + [阳光洒在脸上]。
   ...

4. 使用 video-create 重新生成视频...
   [自动调用视频生成 API]

5. 新视频已生成: 03-video/ep01/sc01/l01/ep01-sc01-l01-c02.mp4
```

### 方法2: 使用命令

在 Claude Code 中创建自定义命令：

```python
# 在 Claude Code 中执行
def auto_regenerate_video(video_path):
    # 1. 评审
    result = quality_control(video_path)

    if not result['is_qualified']:
        # 2. 优化提示词
        optimized_prompt = skill('drama-storyboard', result['improvement_prompt'])

        # 3. 重新生成
        new_video = skill('video-create', optimized_prompt)

        return new_video

    return "视频已合格"

# 使用
auto_regenerate_video('03-video/ep01/sc01/l01/ep01-sc01-l01-c01.mp4')
```

## 工作流程图

```
开始
  ↓
评审视频
  ├─ 合格？
  │   ├─ 是 → 结束
  │   └─ 否 → 继续
  ↓
生成改进建议
  ↓
调用 drama-storyboard skill
  ├─ 输入: 改进建议 + 视频元数据
  └─ 输出: 优化后的视频提示词
  ↓
调用 video-create
  ├─ 输入: 优化后的提示词
  └─ 输出: 新视频文件
  ↓
保存新视频
  ├─ 路径: 原路径 + 新版本号
  └─ 例如: ep01-sc01-l01-c02.mp4
  ↓
（可选）再次评审验证
  ↓
结束
```

## 配置选项

### 自定义合格标准

```bash
# 设置更严格的标准
python3 scripts/auto_regenerate.py video.mp4 \
  --min-total-score 35 \
  --min-dimension-score 6
```

### 指定输出目录

```bash
python3 scripts/auto_regenerate.py video.mp4 \
  -o my_regeneration_output/
```

## 输出文件

自动化脚本会生成以下文件：

```
auto_regeneration_output/
├── auto_regeneration_result.json    # 工作流结果
├── improvement_prompt.txt            # 改进建议
└── optimized_prompt.txt              # 优化后的提示词
```

## 注意事项

1. **Skill 调用限制**
   - drama-storyboard skill 需要在 Claude Code 环境中执行
   - 自动化脚本会生成调用命令，需要手动执行或在 Claude Code 中运行

2. **视频生成时间**
   - 视频生成可能需要几分钟到几十分钟
   - 建议使用异步方式处理批量任务

3. **版本管理**
   - 新视频会自动增加版本号（c01 → c02）
   - 原视频不会被覆盖

4. **API 配额**
   - 注意 Gemini API 和视频生成 API 的配额限制
   - 建议分批处理大量视频

## 故障排除

### 问题1: Skill 调用失败

**原因**: Skill 只能在 Claude Code 环境中执行

**解决方案**:
- 在 Claude Code 对话中使用
- 或手动执行生成的 skill 命令

### 问题2: 视频生成失败

**原因**: 视频生成 API 配置问题

**解决方案**:
- 检查 API Key 配置
- 查看 video-create skill 的认证状态

### 问题3: 提示词质量不佳

**原因**: 改进建议不够具体

**解决方案**:
- 手动调整改进建议
- 或直接编辑生成的提示词文件

## 最佳实践

1. **先测试单个视频**
   - 在批量处理前，先测试单个视频的完整流程
   - 确保所有环节都正常工作

2. **保留原视频**
   - 不要删除原视频，以便对比
   - 使用版本号管理不同版本

3. **记录改进过程**
   - 保存每次的改进建议和优化提示词
   - 分析常见问题，优化评审标准

4. **定期验证**
   - 重新生成后再次评审
   - 确保新视频确实改进了

5. **批量处理策略**
   - 分批处理，避免 API 配额耗尽
   - 使用队列管理，按优先级处理
