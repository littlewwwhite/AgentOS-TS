# 2026-04-24 仓库架构审查

> Status: reviewed  
> Scope: repo architecture, control plane, state model, editability model  
> Priority order: correctness → maintainability → simplicity → extensibility → performance

## 审查前提

本次审查遵循以下第一性原理：

- 真实生产协作的基本单位不是 agent，而是 artifact
- 用户真正需要的不是“任意文件都能改”，而是“任意合法业务节点可介入，且能继续运行”
- `apps/console/` 不是新的主系统，而是现有 skill 仓库的控制面与可视化入口
- 最优先修复的是“假真相源”和“不可恢复编辑”，而不是 UI 或表面结构问题

---

## 总判词

当前仓库的**架构方向总体正确**，但尚未完成从“有状态显示”到“状态成为统一执行真相源”的最后一步。

如果用一句话概括：

> 你已经做出了一个正确的骨架：`single orchestrator + workspace artifact graph + pipeline-state`；  
> 但它现在仍然是**半收敛系统**——文档里的控制真相，与脚本层的真实执行，还没有完全闭合。

这意味着：

- 它**不是错的方向**
- 也**不需要推翻重写**
- 但它还**不能被称为完全一致的生产架构**

---

## 做对了什么

### 1. 仓库主身份没有跑偏

仓库仍以 skill pack 为主，`apps/console/` 只是交互控制台，而不是替代全部 skill 的新 runtime。

这点是对的，因为真实业务里：

- skill 是生产能力
- workspace 是项目空间
- console 是控制面

而不是反过来让 console 成为新的事实源。

参考：

- `README.md`
- `apps/console/src/orchestrator.ts`

### 2. 已经从“prompt 流程”走向“artifact 流程”

这是当前仓库最重要的正确转向。

系统不再只依赖“当前对话说了什么”，而是开始依赖：

- `source.txt`
- `draft/*`
- `output/*`
- `pipeline-state.json`

来表达协作、恢复和继续运行。

这更接近真实生产：

- 编剧交付文本与结构
- 导演交付分镜契约
- 制作交付视频结果
- 后期交付成片衍生物

他们之间真正交换的是**产物**，不是共享上下文。

### 3. “合法编辑点”思路是正确的

`getEditPolicy()` 明确限定了哪些业务节点允许人工修改，这一点非常关键。

因为正确需求不是：

> 任意文件都可以改完继续跑

而是：

> 只有 source / canonical business artifact 可以作为人工介入入口

这与真实业务流程一致，也与 `pipeline-state-contract.md` 的设计一致。

参考：

- `apps/console/src/lib/editPolicy.ts`
- `docs/pipeline-state-contract.md`

### 4. Claude Agent SDK 核心架构没有被破坏

当前 `apps/console/src/orchestrator.ts` 仍然保持单一适配层角色：

- 接收 UI / WS 输入
- 转发给 Claude Agent SDK
- 把事件流回前端

这意味着当前架构改造主要发生在**控制制度层**，而不是侵入 SDK 核心执行模型。

这也是正确的。

---

## P0 问题

### P0-1：`pipeline-state.json` 还不是真正统一的执行真相源

这是当前最大的架构裂缝。

文档已经把 `pipeline-state.json` 定义为跨 skill 的状态索引，并要求：

- 进入阶段写 `running`
- 中断写 `partial` / `failed`
- 门控通过写 `completed` / `validated`

但当前真正会稳定写它的，主要还是 console server：

- 项目 bootstrap
- artifact approve / request change / lock / unlock
- manual edit 写回

而 skill 的执行脚本层，基本仍停留在“文档要求同步维护”，并没有形成统一实现。

这会导致一个危险结果：

> `pipeline-state.json` 看起来像真相源，实际上只是控制面投影。

这是典型的“假真相源”问题。

#### 为什么这很危险

因为用户、UI、恢复逻辑、下一步建议都会信任它。

一旦执行层没有同步写回：

- UI 会误报当前状态
- resume decision 会失真
- 返修与失效链会不完整
- “继续运行”会变成猜测，而不是制度化恢复

#### 结论

当前系统已经有**状态模型**，但还没有真正完成**状态主权收敛**。

---

### P0-2：人工编辑已开放，但没有 contract-level validation

当前保存合法编辑点时，JSON 文件主要只校验语法合法，没有校验结构契约。

这意味着：

- 用户可以修改 `design.json`
- 用户可以修改 `catalog.json`
- 用户可以修改 storyboard JSON

但系统并不能保证这些文件改完以后仍满足后续 skill 的最小输入约束。

这与真实业务需求冲突：

> 导演/编剧当然会改稿，但系统必须保证“改完之后还能继续生产”。

如果没有 artifact-level validator，所谓“可编辑”只是表面上的。

它实际上等价于：

> 允许用户把系统改坏，但只有在后续阶段报错时才知道坏了。

这不是生产系统该有的介入体验。

#### 结论

当前已经有“合法编辑点”，但还没有“合法编辑结果”。

这使得“任意合法节点介入并继续运行”这个目标**尚未真正达成**。

---

## P1 问题

### P1-1：生命周期模型被重复定义，没有唯一领域模型

当前关于 stage order / owner / progress / next stage 的定义分散在多处：

- `projectBootstrap.ts`
- `resumePolicy.ts`
- `overviewWorkbench.ts`
- `artifactActions.ts`
- `workflowProgress.ts`

这说明系统已经知道自己在建一个“流程状态机”，但还没有真正把它收敛成**唯一 workflow model**。

长期风险非常明确：

- 增删一个阶段时容易改漏
- owner / label / terminal status 容易漂移
- UI 展示与 resume 决策可能不一致
- 新人会误以为多个地方都是真相源

#### 结论

当前不是没有模型，而是**模型存在，但被复制了很多次**。

这已经是架构腐化的早期信号。

---

### P1-2：`apps/console/server.ts` 责任已经偏重

当前 `server.ts` 同时承担：

- REST routing
- WebSocket upgrade / session routing
- 项目 bootstrap
- 文件读取与写回
- artifact lifecycle action
- pipeline-state mutation
- 媒体文件静态服务

这不是当前最该先动刀的地方，但已经形成明显的维护热点。

它的问题不是“文件长”，而是：

> 协议入口、业务状态迁移、文件系统操作，正在混在一个控制面文件里。

如果继续增长，后续任何修改都会更容易把：

- API 行为
- 状态逻辑
- 落盘行为

一起耦合破坏。

#### 结论

这是一个需要后续收敛的结构风险，但不是当前第一刀。

---

## P2 问题

### P2-1：验证入口表达不完整

`apps/console` 已经有测试，也能 build / typecheck，但 `package.json` 没把这些作为显式脚本表达出来。

这会带来两个问题：

- 后续 review / CI / 接手者不知道标准验证入口是什么
- 容易错误使用不匹配的测试框架

这不是架构根问题，但它会增加系统的交接成本。

---

### P2-2：部分生命周期语义还不够干净

例如 `unlock` 当前在状态语义上回落为 `approved`。

这说明系统里还存在一部分“操作动作”和“生命周期状态”没有完全正交分离。

本质上：

- `approved` 是审核语义
- `locked` / `editable` 是可编辑性语义

这两个维度不应该在长期演进中继续混写。

不过这属于概念清洁问题，不是当前最危险裂缝。

---

## 根因判断

从第一性原理看，当前系统真正的主对象应该是：

1. `artifact contract`
2. `artifact lifecycle`
3. `invalidation rule`
4. `resume rule`

而不是：

1. agent
2. skill
3. stage shell
4. UI page

你现在已经把系统从“agent / skill 驱动”推进到了“state / artifact 驱动”，这是正确的。

但还缺最后一步：

> 让 artifact contract 和 lifecycle model 不只是文档与 UI 语义，而成为执行层真正共享的制度。

所以根因不是“skill 不够多”，也不是“agent 不够细”，而是：

- 状态写回没有完全统一
- 编辑后没有结构守门
- 生命周期模型还没收敛到单一模块

---

## 最小收敛计划

### Step 1：抽唯一 workflow model

目标不是重构系统，而是抽出一个最小、稳定、共享的领域定义模块，统一以下信息：

- stage order
- stage owner
- stage label
- terminal status
- next stage
- downstream invalidation defaults

让以下模块都依赖它：

- `projectBootstrap`
- `resumePolicy`
- `overviewWorkbench`
- `artifactActions`
- `workflowProgress`

这是当前 ROI 最高、侵入最小的一步。

### Step 2：增加 artifact validator registry

先不要追求大而全，只覆盖最关键、最常被人工修改的主契约：

- `draft/design.json`
- `draft/catalog.json`
- `output/script.json`
- approved storyboard canonical

保存时先做结构校验，再允许写盘，再更新 `pipeline-state.json`。

只有做到这一步，系统才真正支持：

> 在合法节点人工改稿，并保证后续可继续运行。

### Step 3：给 skill 执行层补最小 state writer

不要引入数据库，不要引入 workflow engine，只做一个极小的统一写入 helper。

先让这些关键 skill 接上：

- `script-adapt`
- `script-writer`
- `storyboard`
- `video-gen`

要求它们真正写：

- stage enter → `running`
- mid checkpoint → `partial`
- fail → `failed`
- gate pass → `validated`

只有这样，`pipeline-state.json` 才会从“控制台可视化数据”变成“全仓统一执行索引”。

### Step 4：最后再收敛 `server.ts`

等前三步完成后，再把控制面里的：

- file service
- state transition
- artifact action

拆成更清晰的模块。

这一步是维护性整理，不是当前根问题。

---

## 明确不建议做的事

### 1. 不要推翻成多常驻 agent 架构

真实生产协作靠 artifact 交接，不靠多个长期常驻 agent 互相聊天。

多 agent 只会把“制度问题”错误地实现为“进程问题”。

### 2. 不要引入数据库或 workflow engine

当前问题不是状态存不下，而是状态没有成为统一执行制度。

在这一层加数据库，只会把一个还没收敛清楚的模型固化得更复杂。

### 3. 不要优先做 UI 翻修

当前最危险的问题不是界面是否更好看，而是：

- UI 展示的状态是否可信
- 人工修改后能否继续生产

这两个问题比视觉体验优先级更高。

### 4. 不要照抄 `templates` 的阶段壳层

应当借的是：

- 三层契约意识
- validator 思路
- 路由显式化思路

不该借的是：

- 多壳层 stage shell
- 过重的前端门控
- 过多的外部包装层

---

## 最终结论

这次改动之后，仓库的**大方向没有错，且比之前更接近真正的生产系统**。

但当前还不能说“架构已经稳定收敛”，因为它仍存在两个根问题：

1. `pipeline-state.json` 还没有真正成为统一执行真相源
2. 合法编辑点还缺少结构契约守门

如果只做最小、最关键、最长期有效的改动，下一阶段应该只聚焦三件事：

- 抽唯一 workflow model
- 加 artifact validator registry
- 给关键 skill 接上统一 state writer

做到这三件事之后，当前架构就会从“方向正确的半成品”进入“真正可持续演进的生产骨架”。
