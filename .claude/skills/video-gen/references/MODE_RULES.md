# Video Mode Rules

> Status: audit-first  
> Scope: `video-gen` mode selection, resume, prompt-only vs generate-video, approved-storyboard precedence

## Purpose

这个文档把 `video-gen` 的执行模式从“散落在说明里的经验规则”收敛成一套显式顺序：

1. 先判断输入事实是什么
2. 再判断用户要做到哪一步
3. 最后才决定命令怎么跑

## First-Principles Rule

`video-gen` 的职责不是“重新创作分镜”，而是：

- 消费已有 script / storyboard artifact
- 生成或导出 VIDEO 运行时 storyboard
- 执行视频生成
- 输出 delivery artifact

因此模式判断优先级必须是：

1. **是否已有 approved storyboard canonical**
2. **用户要 prompt 还是要 video**
3. **是否处于 resume 场景**
4. **Auto / Manual 参数选择**

## Mode Priority

### Rule 1: Approved Canonical Wins

若存在：

- `output/storyboard/approved/ep{NNN}_storyboard.json`

则这个文件是导演锁版事实源。

在这种情况下：

- Phase 1 的职责变成**导出 VIDEO runtime storyboard**
- 不应再从 `output/script.json` 重写这一集导演产物

### Rule 2: User Intent Determines Scope

| User intent | Mode result |
| --- | --- |
| 只要提示词 / 只生成分镜提示词 | `prompt_only` |
| 要视频成片 / 一键生成视频 | `prompt_and_video` |
| 已有 storyboard，只要跑视频 | `video_only` |

### Rule 3: Resume Beats Fresh Start

若存在以下任一事实：

- `output/ep{NNN}/ep{NNN}_storyboard.json`
- `output/ep{NNN}/ep{NNN}_delivery.json`
- `pipeline-state.json` 中 `episodes.ep{NNN}.video.status = partial`

则优先视为 **resume**，而不是 fresh run。

### Rule 4: Auto / Manual Is Parameter Policy, Not Business Mode

- `auto` / `manual` 只决定模型、参考模式、分辨率、比例等参数如何确定
- 它们**不决定**是否该从 script 重写 storyboard

## Canonical Modes

### `prompt_only`

适用：

- 用户只要 prompts
- 用户要先检查分镜文本，不立即出视频

执行结果：

- 生成或导出 runtime storyboard
- 不触发视频生成

### `prompt_and_video`

适用：

- 用户要从当前合法输入一路生成视频

执行结果：

- Phase 1：生成或导出 runtime storyboard
- Phase 2：批量生成视频并输出 delivery

### `video_only`

适用：

- 已经有 approved storyboard 或 runtime storyboard
- 用户只想继续视频生成，不想重做提示词

执行结果：

- 直接进入 Phase 2

### `resume`

适用：

- 已有 runtime storyboard / partial delivery / partial state

执行结果：

- 从最近合法 VIDEO 节点继续
- 不清空已有可复用 artifact

## Selection Table

| Condition | Chosen mode |
| --- | --- |
| approved storyboard exists + user wants video | `video_only` or `prompt_and_video` with export-only Phase 1 |
| approved storyboard exists + user only wants prompts | `prompt_only` with export-only Phase 1 |
| no approved storyboard + user only wants prompts | `prompt_only` |
| no approved storyboard + user wants video | `prompt_and_video` |
| runtime storyboard or delivery partial exists | `resume` layered over above |

## Resume Rules

### Reuse

以下情况默认复用：

- approved storyboard canonical
- 已写出的 runtime storyboard
- 已完成的 clip mp4
- 已写出的 delivery records

### Regenerate Only If

以下情况才应重生成：

1. 用户明确要求重新生成 prompts
2. 上游 canonical storyboard 已变更并使 runtime export 失效
3. 当前 runtime storyboard 不满足最小校验规则

## Continuity Rule

当前连续性默认只在**同一 scene 内 clip 级续接**使用：

- 同场连续 clip：允许使用上一 clip 末帧作为参考
- 跨 scene：默认不自动继承连续性参考

不要在 mode selection 阶段假设存在跨 scene 连续性制度。

## Non-Goals

本规则当前不定义：

- EDITING / MUSIC / SUBTITLE 阶段
- 多集项目的最终发布策略
- 导演如何编辑 storyboard canonical
