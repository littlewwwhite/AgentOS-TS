# Video Review Workbench Design

## Goal

将 `StoryboardView` 和视频页收敛为同一种审片工作台：参考小云雀编辑页的“资产库 + 当前片段脚本 + 视频预览 + 底部时间线”逻辑，让用户围绕当前片段审 prompt、看视频、查资产、切换时间线，而不是在裸文件播放器和 JSON 之间来回跳。

目标优先覆盖两类体验：

- 视频审片逻辑：播放器、片段轨、镜头详情、生成状态、整集/片段播放同步。
- 视觉布局风格：左侧常驻资产库、中间脚本与预览并排、底部横向时间线、顶部生产配置与状态。

## Reference Observations

参考页 `https://xyq.jianying.com/novel/edit?...` 登录后呈现的核心结构：

- 顶部生产栏：返回、集标题、积分/预算、模型、清晰度、导出、合成全集。
- 左侧资产库：角色、场景按类型分组，使用缩略图卡片，可进入编辑。
- 中部脚本区：当前片段标题、时长约束说明、富文本 prompt、资产引用 chip、内联镜头时长控件。
- 右侧预览区：当前片段竖屏视频播放器，带截图/下载/播放控制。
- 底部时间线：整集播放入口、当前时间/总时长、片段卡片、片段间插入点、多选。
- 联动逻辑：点击底部片段会同步当前片段标题、脚本内容、视频预览和播放时间。
- 编辑逻辑：点击“编辑脚本”只进入当前片段局部编辑态，按钮切换为取消/保存。

## Layout Decision

现有左侧 `Navigator` 不替换、不删除。它是项目级导航，负责跨阶段、跨文件、跨分集跳转。

新增的资产库作为工作台内部的 `ProductionAssetRail`，只在故事板和视频审片页常驻。两者职责正交：

- `Navigator`：项目导航。入口包括输入源、视觉设定、剧本开发、素材总览、分集视频。
- `ProductionAssetRail`：当前审片上下文。入口包括当前集/当前片段使用的角色、场景、道具。

宽屏下形成双左侧结构：外层是全局导航，内层是工作台资产库。中等宽度保留资产库，优先压缩聊天面板。窄屏时资产库可退化为抽屉，但全局导航的项目跳转能力必须保留。

## Component Model

建议拆分为共享工作台组件，避免继续让 `StoryboardView` 和 `VideoGridView` 各自维护一套片段逻辑。

- `EpisodeReviewWorkbench`
  - 加载 storyboard、script、catalog、project tree。
  - 构建 `StoryboardEditorModel`。
  - 维护 `currentClipKey`、`selectedShotKey`、`episodeTime`、`playbackStatus`。
  - 编排播放器、脚本区、资产库和时间线的联动。

- `ProductionAssetRail`
  - 从 `scriptData`、`catalogData`、storyboard scenes 和资产目录派生角色、场景、道具。
  - 当前片段用到的资产高亮。
  - 当前集出现过的资产正常显示。
  - 全项目资产可折叠为“全部素材”。

- `SegmentScriptPanel`
  - 只读态渲染小云雀式脚本：资产引用 chip、镜头时长 badge、分镜段落。
  - 编辑态只作用于当前片段，提供取消/保存。
  - prompt 解析失败时显示原文，避免有损重写。

- `SegmentVideoPreview`
  - 播放当前片段或整集视频。
  - 负责 `loadedmetadata`、`timeupdate`、`ended`、`play`、`pause` 事件。
  - 不直接读取 storyboard 结构，只消费 workbench 传入的视频源和时间状态。

- `SegmentTimeline`
  - 显示 clip 缩略图、编号、时长、生成状态、选中态。
  - 点击片段更新 `currentClipKey` 和播放器时间。
  - 播放整集时根据 `episodeTime` 反向高亮当前 clip/shot。

## Data Flow

主状态只保留一个当前片段选择：

- 用户点击时间线片段 -> `currentClipKey` 更新 -> 脚本区、预览区、资产库高亮同步更新。
- 播放器时间变化 -> 根据 `resolveStoryboardSelectionAtTime` 推导 clip/shot -> 反向更新选中态。
- 当前 clip 变化 -> 派生当前 scene、clip data、script source、prompt、视频路径、资产引用。

`StoryboardEditorModel` 是长半衰期接口，应继续放在 `apps/console/src/lib/storyboard.ts` 或相邻纯函数中。UI 组件只消费模型，不重复解析路径、时长和 selection。

## Migration Plan

### Phase 1: Extract Shared Review Model

先不大改视觉。将 `StoryboardView` 中已有的选择、播放同步、视频路径、片段模型逻辑抽成 hook 或 `EpisodeReviewWorkbench` 的无样式内核。

结果：

- `StoryboardView` 仍可工作。
- `VideoGridView` 后续可复用同一模型。
- 降低后续 UI 改造风险。

### Phase 2: Add ProductionAssetRail

新增只读资产库，挂在故事板/视频工作台内部。

首版能力：

- 角色、场景、道具分组。
- 缩略图、名称、状态 fallback。
- 当前片段资产高亮。
- 当前集资产常驻。

不在首版实现拖拽、插入引用、资产编辑，以免和 prompt 编辑器强耦合。

### Phase 3: Replace VideoGridView With Review Workbench

打开 `output/ep001` 时，优先查找该集 runtime storyboard：

- `output/ep001/ep001_storyboard.json`
- `state.episodes[ep].storyboard.artifact`
- 可推导的 approved storyboard fallback

找到 storyboard 时进入视频审片工作台。找不到时保留当前文件网格 fallback，并提示“未找到分镜结构，按文件展示视频”。

### Phase 4: Improve Script Editing

在 `SegmentScriptPanel` 中逐步替换纯 textarea：

- 只读态先实现 chip 化展示。
- 编辑态先沿用 textarea 或局部字段编辑。
- 后续再实现 `@` 引用、时长控件、资产插入。

## Empty And Error States

- 缺 storyboard：视频页退回文件网格。
- 缺单个 clip 视频：时间线仍显示片段，预览区显示待生成占位。
- 缺整集视频：使用片段播放或现有 `episode-preview` 合成预览。
- 缺资产图片：资产库显示名称和空缩略图。
- prompt 解析失败：展示原文，不做 chip 化。
- 保存失败：局部编辑态保留未保存内容，并显示保存错误。

## Test Plan

- `buildStoryboardEditorModel` 能从 runtime storyboard 正确生成 clip/shot、路径和时长。
- 点击 timeline 片段会更新脚本区、播放器源、当前时间。
- 播放整集视频时，时间变化能反向高亮当前 clip/shot。
- `ProductionAssetRail` 能区分当前片段资产、当前集资产和全项目资产。
- `VideoGridView` 在有 storyboard 时进入审片工作台，在无 storyboard 时保留文件网格 fallback。
- 编辑态保存只影响当前片段 prompt/时长，不误改其他片段。

## Non Goals

- 不替换全局 `Navigator`。
- 不移除全局素材页。
- 不在首版实现完整富文本 prompt 编辑器。
- 不改变底层视频生成、合成、导出接口。
- 不引入新的运行时壳层或独立路由体系。
