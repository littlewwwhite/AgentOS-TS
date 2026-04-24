# Console Usability MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让导演/编剧可以从“新建项目并上传文档”一路走到“知道当前状态、知道下一步、并用对话继续推进到批量连续视频生成”。

**Architecture:** 保持现有 `artifact-first + pipeline-state` 骨架不变，不侵入 Claude Agent SDK / orchestrator 核心；只补 console control plane 的 4 个最小能力：项目初始化、信息架构收敛、流程状态可视化、对话式继续运行入口。所有新增行为优先落到纯函数和小型 API，再由 UI 消费，避免把业务规则散落在组件里。

**Tech Stack:** Bun, Bun server, React 19, TypeScript, 现有 `ProjectContext` / `TabsContext` / `pipeline-state.json` 合约，无新增依赖。

---

## Scope

### In Scope
- 新建项目 + 上传源文档 + 初始化工作区
- 侧边栏按“真实创作流程”重排
- 隐藏当前 MVP 不需要的后期阶段（剪辑 / 配乐 / 字幕）
- 总览页强化为“状态 + 下一步 + 工作区 + 处理入口”
- 聊天区提示词按当前状态变化，承接主流程命令
- 补充一步一步手动 E2E 验证清单

### Out of Scope
- 不修改 orchestrator 核心流式协议
- 不新增复杂路由或状态管理库
- 不接入真正的 DOCX/PDF 自动转换链路（本轮先建入口与占位规则）
- 不恢复剪辑/配乐/字幕 UI

### User Journey Target
1. 打开 console
2. 点击“新建项目”
3. 输入项目名并上传小说 / 梗概
4. 自动创建 `workspace/{name}`、`input/*`、`source.txt`、`pipeline-state.json`
5. 自动进入总览页
6. 在总览页看到：当前流程状态、下一步、输入源、待审核/返修/失效
7. 在聊天区直接发送“继续推进到分镜 / 继续生成第 1-10 集视频”之类命令

---

### Task 1: Add project bootstrap domain logic and API

**Files:**
- Create: `apps/console/src/lib/projectBootstrap.ts`
- Modify: `apps/console/server.ts`
- Test: `apps/console/test/projectBootstrap.test.ts`
- Test: `apps/console/test/sourceUpload.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildProjectBootstrap } from "../src/lib/projectBootstrap";

describe("buildProjectBootstrap", () => {
  test("creates minimal workspace skeleton for a new script project", () => {
    const plan = buildProjectBootstrap({
      projectName: "新项目 A",
      sourceFilename: "novel.md",
      sourceContentType: "text/markdown",
    });

    expect(plan.projectKey).toBe("新项目 A");
    expect(plan.files.map((file) => file.path)).toEqual([
      "input/novel.md",
      "source.txt",
      "pipeline-state.json",
    ]);
    expect(plan.initialState.current_stage).toBe("SCRIPT");
    expect(plan.initialState.next_action).toBe("review SCRIPT");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/console/test/projectBootstrap.test.ts`
Expected: FAIL with module/function not found.

**Step 3: Write minimal implementation**

```ts
export function buildProjectBootstrap(input: {
  projectName: string;
  sourceFilename: string;
  sourceContentType?: string | null;
}) {
  return {
    projectKey: input.projectName.trim(),
    files: [
      { path: `input/${sanitizeUploadFilename(input.sourceFilename)}`, kind: "raw" },
      { path: "source.txt", kind: "canonical-source" },
      { path: "pipeline-state.json", kind: "control" },
    ],
    initialState: {
      version: 1,
      current_stage: "SCRIPT",
      next_action: "review SCRIPT",
      last_error: null,
      stages: {
        SCRIPT: { status: "in_review", artifacts: ["source.txt"] },
      },
      episodes: {},
      artifacts: {
        "source.txt": {
          kind: "source",
          owner_role: "writer",
          status: "in_review",
          editable: true,
          revision: 1,
          depends_on: [],
          invalidates: [],
        },
      },
      change_requests: [],
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test apps/console/test/projectBootstrap.test.ts apps/console/test/sourceUpload.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/console/src/lib/projectBootstrap.ts apps/console/server.ts apps/console/test/projectBootstrap.test.ts apps/console/test/sourceUpload.test.ts
git commit -m "feat: add console project bootstrap endpoint"
```

**Implementation notes:**
- 在 `apps/console/server.ts` 新增 `POST /api/projects/bootstrap`
- 请求体使用 `multipart/form-data`，字段至少包含 `projectName` 和 `file`
- 若项目已存在，返回 `409`
- 若上传的是 `txt/md`，直接镜像到 `source.txt`
- 若上传的是 `doc/docx/pdf`，本轮先落到 `input/*`，并生成明确提示，不自动转换

---

### Task 2: Add empty-state onboarding UI for new project creation

**Files:**
- Create: `apps/console/src/components/Viewer/views/ProjectOnboardingView.tsx`
- Modify: `apps/console/src/components/Viewer/Viewer.tsx`
- Modify: `apps/console/src/components/Navigator/ProjectSwitcher.tsx`
- Test: `apps/console/test/projectOnboardingView.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectOnboardingView } from "../src/components/Viewer/views/ProjectOnboardingView";

describe("ProjectOnboardingView", () => {
  test("renders new-project entry, upload guidance, and e2e steps", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectOnboardingView, {
        onCreate: () => undefined,
        isSubmitting: false,
      }),
    );

    expect(html).toContain("新建项目");
    expect(html).toContain("上传源文档");
    expect(html).toContain("一步一步开始");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/console/test/projectOnboardingView.test.tsx`
Expected: FAIL with component not found.

**Step 3: Write minimal implementation**

```tsx
export function ProjectOnboardingView(props: {
  onCreate: (input: { projectName: string; file: File | null }) => void;
  isSubmitting: boolean;
}) {
  return (
    <section>
      <h1>新建项目</h1>
      <p>1. 输入项目名 2. 上传源文档 3. 初始化工作区 4. 进入总览继续推进</p>
      <input aria-label="项目名" />
      <input type="file" aria-label="上传源文档" />
      <button type="button">开始</button>
    </section>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `bun test apps/console/test/projectOnboardingView.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/console/src/components/Viewer/views/ProjectOnboardingView.tsx apps/console/src/components/Viewer/Viewer.tsx apps/console/src/components/Navigator/ProjectSwitcher.tsx apps/console/test/projectOnboardingView.test.tsx
git commit -m "feat: add onboarding view for new console projects"
```

**Implementation notes:**
- `Viewer` 在 `!name` 时，不再只显示“选择一个项目以开始”，改为显示 onboarding view
- `ProjectSwitcher` 增加明确的 `新建项目` 入口，不再只是一条下拉框
- onboarding 的主按钮必须有明显主视觉，不可继续沿用与二级按钮相同的 outline 风格

---

### Task 3: Rebuild navigator information architecture around the real production flow

**Files:**
- Create: `apps/console/src/lib/navigatorSections.ts`
- Modify: `apps/console/src/components/Navigator/Navigator.tsx`
- Modify: `apps/console/src/components/Navigator/EpisodeNode.tsx`
- Test: `apps/console/test/navigatorSections.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildNavigatorSections } from "../src/lib/navigatorSections";

describe("buildNavigatorSections", () => {
  test("orders navigation as overview, inputs, script, assets, episodes for current MVP", () => {
    const sections = buildNavigatorSections({
      hasSource: true,
      hasScript: true,
      hasAssets: true,
      episodeIds: ["ep001"],
    });

    expect(sections.map((section) => section.key)).toEqual([
      "overview",
      "inputs",
      "script",
      "assets",
      "episodes",
    ]);
  });

  test("hides editing, music, subtitle nodes in current MVP", () => {
    const sections = buildNavigatorSections({ hasSource: true, hasScript: true, hasAssets: false, episodeIds: ["ep001"] });
    expect(JSON.stringify(sections)).not.toContain("剪辑");
    expect(JSON.stringify(sections)).not.toContain("配乐");
    expect(JSON.stringify(sections)).not.toContain("字幕");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/console/test/navigatorSections.test.ts`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

```ts
export function buildNavigatorSections(input: {
  hasSource: boolean;
  hasScript: boolean;
  hasAssets: boolean;
  episodeIds: string[];
}) {
  const sections = [{ key: "overview", label: "总览" }];
  if (input.hasSource) sections.push({ key: "inputs", label: "输入源" });
  if (input.hasScript) sections.push({ key: "script", label: "剧本开发" });
  if (input.hasAssets) sections.push({ key: "assets", label: "素材" });
  if (input.episodeIds.length > 0) sections.push({ key: "episodes", label: "分集视频" });
  return sections;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test apps/console/test/navigatorSections.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/console/src/lib/navigatorSections.ts apps/console/src/components/Navigator/Navigator.tsx apps/console/src/components/Navigator/EpisodeNode.tsx apps/console/test/navigatorSections.test.ts
git commit -m "feat: simplify navigator for current production scope"
```

**Implementation notes:**
- `草稿` 不应再晚于 `分集`
- `草稿` 概念应被重命名/吸收到 `输入源` 与 `剧本开发`
- `EpisodeNode` 当前只保留：`分镜`、`视频`
- `原片/剪辑/配乐/成片` 统统从当前 MVP 导航隐藏

---

### Task 4: Make state visible and actionable on Overview

**Files:**
- Create: `apps/console/src/lib/workflowProgress.ts`
- Modify: `apps/console/src/components/Viewer/views/OverviewView.tsx`
- Modify: `apps/console/src/components/Navigator/StatusBadge.tsx`
- Test: `apps/console/test/workflowProgress.test.ts`
- Test: `apps/console/test/overviewViewChrome.test.tsx`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildWorkflowProgress } from "../src/lib/workflowProgress";

describe("buildWorkflowProgress", () => {
  test("marks current, blocked, and hidden stages for the current MVP", () => {
    const items = buildWorkflowProgress({
      currentStage: "SCRIPT",
      stageStatuses: {
        SCRIPT: "in_review",
        STORYBOARD: "not_started",
        VIDEO: "not_started",
      },
    });

    expect(items.find((item) => item.key === "SCRIPT")?.state).toBe("current");
    expect(items.find((item) => item.key === "SCRIPT")?.label).toBe("剧本");
    expect(items.some((item) => item.key === "EDITING")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/console/test/workflowProgress.test.ts`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

```ts
const STAGES = ["INSPIRATION", "SCRIPT", "VISUAL", "STORYBOARD", "VIDEO"] as const;

export function buildWorkflowProgress(input: {
  currentStage: string;
  stageStatuses: Record<string, string>;
}) {
  return STAGES.map((stage) => ({
    key: stage,
    label: mapStageLabel(stage),
    state: stage === input.currentStage ? "current" : deriveVisualState(input.stageStatuses[stage]),
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `bun test apps/console/test/workflowProgress.test.ts apps/console/test/overviewViewChrome.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/console/src/lib/workflowProgress.ts apps/console/src/components/Viewer/views/OverviewView.tsx apps/console/src/components/Navigator/StatusBadge.tsx apps/console/test/workflowProgress.test.ts apps/console/test/overviewViewChrome.test.tsx
git commit -m "feat: add visual workflow progress and stronger next-step UI"
```

**Implementation notes:**
- Overview 顶部新增一条横向流程条：`输入 → 剧本 → 素材 → 分镜 → 视频`
- “当前状态”卡片保留，但改成更强主次层级：
  - 主信息：当前所处阶段 / 是否正常
  - 次信息：为什么 / 下一步
  - 主按钮：继续处理入口
- 减少边框：同组内容合并为单一容器，内部靠留白与字重分层
- 主按钮使用实心 accent 样式；次按钮保留文字按钮或轻 outline

---

### Task 5: Make chat the default continuation lane instead of a detached side panel

**Files:**
- Create: `apps/console/src/lib/chatSuggestions.ts`
- Modify: `apps/console/src/components/Chat/ChatPane.tsx`
- Modify: `apps/console/src/App.tsx`
- Test: `apps/console/test/chatSuggestions.test.ts`
- Test: `apps/console/test/chatPaneChrome.test.tsx`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildChatSuggestions } from "../src/lib/chatSuggestions";

describe("buildChatSuggestions", () => {
  test("suggests bootstrap commands when no project is selected", () => {
    const suggestions = buildChatSuggestions({ hasProject: false });
    expect(suggestions[0]).toContain("新建项目");
  });

  test("suggests continuation commands from current state", () => {
    const suggestions = buildChatSuggestions({
      hasProject: true,
      workflowTone: "review",
      currentStage: "SCRIPT",
    });
    expect(suggestions[0]).toContain("审核");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/console/test/chatSuggestions.test.ts`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

```ts
export function buildChatSuggestions(input: {
  hasProject: boolean;
  workflowTone?: "review" | "blocked" | "stale" | "ready" | "running" | "complete" | "error";
  currentStage?: string;
}) {
  if (!input.hasProject) return ["帮我新建项目并上传源文档", "创建一个新项目", "上传小说并初始化工作区"];
  if (input.workflowTone === "review") return [`帮我审核当前${input.currentStage}产物`, "打开待审核入口", "继续下一步"];
  if (input.workflowTone === "stale") return ["从失效阶段重新生成", "继续推进当前项目", "帮我恢复流程"];
  return ["继续推进当前项目", "告诉我下一步", "打开当前工作入口"];
}
```

**Step 4: Run test to verify it passes**

Run: `bun test apps/console/test/chatSuggestions.test.ts apps/console/test/chatPaneChrome.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/console/src/lib/chatSuggestions.ts apps/console/src/components/Chat/ChatPane.tsx apps/console/src/App.tsx apps/console/test/chatSuggestions.test.ts apps/console/test/chatPaneChrome.test.tsx
git commit -m "feat: align chat suggestions with project workflow state"
```

**Implementation notes:**
- 不是让对话取代 UI，而是让对话承接“发起和继续”
- 聊天区空态建议不能再写死“开始剪辑”这类越阶段提示
- 顶部可增加一个“把下一步发送到对话框”的轻动作，打通总览与聊天

---

### Task 6: Add a step-by-step E2E smoke checklist for the real user flow

**Files:**
- Create: `docs/plans/2026-04-23-console-usability-mvp-e2e-checklist.md`
- Modify: `README.md`

**Step 1: Write the failing test**

No code test. Write the manual checklist first.

**Step 2: Verify the checklist is complete before implementation signoff**

Checklist must cover:
1. 打开 console
2. 新建项目
3. 上传 `txt/md`
4. 自动创建 `workspace/{name}`
5. 自动出现 `source.txt`
6. 出现 `pipeline-state.json`
7. Overview 显示当前状态与下一步
8. 侧边栏只出现当前 MVP 必需结构
9. 聊天建议与当前状态一致
10. 能从聊天继续推进

**Step 3: Write the checklist**

```md
# Console Usability MVP E2E Checklist

- [ ] Start console with `cd apps/console && bun run dev`
- [ ] Open browser and confirm onboarding appears when no project is selected
- [ ] Create project `demo-ui`
- [ ] Upload `fixtures/demo.md`
- [ ] Confirm `workspace/demo-ui/input/demo.md` exists
- [ ] Confirm `workspace/demo-ui/source.txt` exists
- [ ] Confirm `workspace/demo-ui/pipeline-state.json` exists
- [ ] Confirm overview shows current state + next step
- [ ] Confirm navigator order is overview → inputs → script → assets? → episodes
- [ ] Confirm no editing/music/subtitle nodes are visible
- [ ] Send `继续推进当前项目` in chat and confirm WS round-trip succeeds
```

**Step 4: Re-run docs / smoke verification**

Run:
- `bun test apps/console/test`
- `cd apps/console && bun x tsc --noEmit`
- Manual checklist above

Expected: all automated checks PASS, manual checklist complete.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-23-console-usability-mvp-e2e-checklist.md README.md
git commit -m "docs: add console usability mvp smoke checklist"
```

---

## Final Verification Commands

Run in this order:

```bash
bun test apps/console/test/projectBootstrap.test.ts
bun test apps/console/test/projectOnboardingView.test.tsx
bun test apps/console/test/navigatorSections.test.ts
bun test apps/console/test/workflowProgress.test.ts
bun test apps/console/test/chatSuggestions.test.ts
bun test apps/console/test
cd apps/console && bun x tsc --noEmit
```

Expected:
- All targeted tests PASS during each task
- Full `bun test apps/console/test` PASS at the end
- TypeScript check PASS
- Manual E2E checklist complete

## Risks to Watch

- `pipeline-state.json` 初始化字段若不完整，会导致 `OverviewView` / `Navigator` 空引用
- 新项目创建后若不自动切换 `ProjectContext.name`，会让用户误以为创建失败
- 上传 `docx/pdf` 但不生成 `source.txt` 时，UI 必须给出明确提示，不可假装已经可继续脚本流程
- 若导航逻辑直接写死在组件里，后续恢复剪辑/配乐/字幕时会再次混乱；本轮必须先抽成纯函数
- 聊天建议词不能越过状态机，不能在 `review` / `stale` 时建议“继续下游剪辑”

## Minimal Acceptance Criteria

- 用户第一次进入页面时，能直接开始“新建项目 + 上传文档”
- 用户上传文本后，工作区与 `source.txt` 可见
- 用户始终能看见：当前状态、是否阻塞、下一步
- 侧边栏只保留当前 MVP 需要的生产结构
- 用户既可以点按钮继续，也可以用对话继续
