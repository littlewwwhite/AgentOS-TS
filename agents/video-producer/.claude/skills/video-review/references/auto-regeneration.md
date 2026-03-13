# 自动化视频重新生成使用指南

## 功能说明

当视频被判定为不合格时，video-review 会执行以下流程：

1. 评审视频质量，输出不合格原因和改进建议
2. 使用 `scripts/optimizer.py` 基于评审结果优化视频生成提示词
3. 使用 video-create skill 重新生成视频
4. （可选）对新视频再次评审验证

## 使用方式

### 方式1: 使用自动化脚本（推荐）

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/auto_regenerate.py <视频路径>
```

脚本会自动完成评审 → 生成改进建议 → 优化提示词 → 输出重新生成所需参数，然后由 video-create skill 负责实际的视频生成任务。

### 方式2: 在 Claude Code 中对话触发

告知 video-review agent 评审视频路径，如判定不合格，它会：

1. 给出具体不合格原因（维度得分、总分）
2. 生成优化后的视频提示词
3. 调用 video-create skill 使用优化提示词重新生成视频

## 工作流程

```
开始
  ↓
评审视频（video-review）
  ├─ 合格？
  │   ├─ 是 → 记录到 final_selection.json → 结束
  │   └─ 否 → 继续
  ↓
生成改进建议（evaluator.py 输出 *_review.json）
  ↓
优化提示词（scripts/optimizer.py）
  ├─ 输入: 评审结果 + 改进建议
  └─ 输出: 优化后的视频提示词
  ↓
使用 video-create skill 重新生成视频
  ├─ 输入: 优化后的提示词
  └─ 输出: 新视频文件（版本号递增，如 c01 → c02）
  ↓
（可选）再次评审验证
  ↓
结束
```

## 批量处理

```bash
for video in 03-video/ep01/sc01/*/*.mp4; do
    echo "处理: $video"
    python3 ${CLAUDE_SKILL_DIR}/scripts/auto_regenerate.py "$video"
    echo "---"
done
```

## 配置选项

```bash
# 自定义合格标准
python3 ${CLAUDE_SKILL_DIR}/scripts/auto_regenerate.py video.mp4 \
  --min-total-score 35 \
  --min-dimension-score 6

# 指定输出目录
python3 ${CLAUDE_SKILL_DIR}/scripts/auto_regenerate.py video.mp4 \
  -o my_regeneration_output/
```

## 输出文件

```
auto_regeneration_output/
├── auto_regeneration_result.json    # 工作流结果
├── improvement_prompt.txt            # 改进建议
└── optimized_prompt.txt              # 优化后的提示词
```

## 版本管理

- 新视频自动增加版本号（c01 → c02），原视频不会被覆盖
- 所有版本保存在同一目录下，便于对比
- 重新生成后建议再次评审，确认质量确实提升

## 注意事项

- 视频生成可能需要几分钟到几十分钟，建议使用异步方式处理批量任务
- 注意 Gemini API 和视频生成 API 的配额限制，建议分批处理
- 在批量处理前，先测试单个视频的完整流程，确保所有环节正常
