---
name: video-create
description: 通过 anime-material-workbench API 生成视频，支持图生视频、文生视频等操作与异步任务管理。
---

# Video Create Skill

通过 anime-material-workbench 生成视频，并管理异步任务。

**Base URL（固定）：** `https://animeworkbench.lingjingai.cn`

## Resources

- **上传脚本**：`scripts/upload_to_cos.py` — 将本地图片/视频上传至腾讯云 COS 并返回可访问 URL

## References

| 文件 | 内容 |
|:-----|:-----|
| `${CLAUDE_SKILL_DIR}/video-create-references/prompt-params-spec.md` | 参数类型解析规则（ENUM/INT/FLOAT/FileListType/FrameListType/multi_prompt）与 JSON 组装示例 |
| `${CLAUDE_SKILL_DIR}/video-create-references/reference-video-mode.md` | 参考生视频模式协议（multi_param + richTaskPrompt 结构） |

## Bundled Scripts

Deterministic scripts in `${CLAUDE_SKILL_DIR}/scripts/`, via `Bash` tool调用。

| Script | Purpose |
|--------|---------|
| `auth.py` | Token management module - auto-refresh JWT from refreshToken, print user info |
| `login.py` | Initial login via phone + SMS code, team selection, persist session to config file |
| `submit_video_create.py` | Submit video generation task with model code, prompt, and parameters |
| `poll_video_create_task.py` | Poll video task status until SUCCESS/FAIL or timeout |
| `upload_to_cos.py` | Upload local files to Tencent COS with public-read ACL, return accessible URL |

---

## Token 管理机制

Token 通过 `refreshToken` 接口获取（网关白名单，无需 Authorization）。认证状态持久化存储在 `~/.animeworkbench_auth.json` 中，由 `scripts/auth.py` 自动管理。

---

## Workflow

### 0. 初始化认证

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/auth.py
```

- 输出 `userId`/`groupId`/`userName` → 认证正常，进入步骤 1
- 报错 → 执行登录流程

#### 登录流程

**第一步：** 告知用户打开 **https://animeworkbench.lingjingai.cn/home**，在登录页输入手机号并获取验证码，将手机号和验证码告知。

**第二步：** 执行登录：

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/login.py --phone <手机号> --code <验证码>
```

**第三步：** 处理退出码：

- **退出码 0（单团队）**：登录完成，进入步骤 1
- **退出码 2（多团队）**：解析输出中 `TEAMS_JSON:` 行的 JSON，展示团队列表让用户选择，然后执行：
  ```bash
  python3 ${CLAUDE_SKILL_DIR}/scripts/login.py --select-group <groupId>
  ```

> **备用方式**（已有 refreshToken）：
> ```bash
> python3 ${CLAUDE_SKILL_DIR}/scripts/login.py --refresh-token <SID> [--group-id <groupId>]
> ```

### 0.5 切换团队（已登录用户随时可用）

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/login.py --select-group <groupId>
```

脚本自动完成：更新本地 `groupId` → 调用 `updateCurrentGroup` → 用新 token 覆盖旧缓存。后续 API 调用自动使用新 token。

### 1. 收集必要信息

向用户确认 `taskPrompt`（视频描述提示词，部分模型必填）。

### 2. 调用模型列表接口（仅调用一次）

```bash
python3 -c "
import sys; sys.path.insert(0, '$HOME/.claude/skills/video-create/scripts')
import auth, json
result = auth.api_request('https://animeworkbench.lingjingai.cn/api/resource/model/list/usage/VIDEO_CREATE',
    data=b'{}', method='POST')
print(json.dumps(result, ensure_ascii=False))
"
```

过滤 `isDeleted == 0` 的模型，展示为编号列表（模型名称 + modelCode）。

### 3. 让用户选择模型

**模型选择是必填的，不能假设默认值，必须等用户明确选择。** 选定后从步骤 2 缓存中取出 `modelCode`、`handleCode`、`modelParams`，不发起新请求。

### 4. 展示模型参数并让用户确认

从步骤 2 缓存中取出所选模型的 `modelParams`，按类型展示所有参数及可选值。

各参数类型的解析规则详见 → `${CLAUDE_SKILL_DIR}/video-create-references/prompt-params-spec.md`

参考生视频模式（`reference_video: true`）详见 → `${CLAUDE_SKILL_DIR}/video-create-references/reference-video-mode.md`

将用户确认结果组装为 `promptParams` JSON。未填且有 `default` 的用默认值；无默认值且未填则不传。

### 4.5 上传本地文件到 COS

仅当 FileListType 或 FrameListType 参数为本地文件时执行：

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/upload_to_cos.py \
  --file /path/to/file.jpg \
  [--scene-type material-video-create]
```

脚本自动获取 Token 和 Group ID，上传成功后输出 `文件 URL: https://...`。

### 5. 提交视频生成任务

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/submit_video_create.py \
  --model-code "MODEL_CODE" \
  [--handle-code "HANDLE_CODE"] \
  --prompt "视频描述" \
  --prompt-params '{"key":"value"}'
```

从输出的 `taskId:` 行取得 taskId。

### 6. 后台轮询任务状态

**必须使用 `run_in_background: true`**：

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/poll_video_create_task.py \
  --task-id "TASK_ID"
```

提交后立即告知用户任务已提交、后台轮询中。脚本每 5 秒查询一次，直到 `SUCCESS` 或 `FAIL`。完成后自动通知。

### 7. 处理结果

- **SUCCESS**：展示 `结果文件：` 或 `展示文件：` 下的视频 URL
- **FAIL**：告知 `生成失败！错误信息：` 内容

---

## 其他可用接口

### 积分预估

```bash
python3 -c "
import sys; sys.path.insert(0, '$HOME/.claude/skills/video-create/scripts')
import auth, json
body = json.dumps({'modelCode': 'MODEL_CODE', 'handleCode': 'HANDLE_CODE', 'promptParams': {}}).encode()
result = auth.api_request('https://animeworkbench.lingjingai.cn/api/material/creation/videoCreateFeeCalc',
    data=body, method='POST')
print(json.dumps(result, ensure_ascii=False))
"
```

---

## Key Rules

- **模型列表接口全程只调用一次**，模型信息和参数均从该次响应获取，不重复请求
- **模型必须由用户明确选择**，禁止假设或使用默认 modelCode
- `isDeleted == 1` 的模型不展示
- `handleCode` 从模型信息取得，多个 handler 需让用户选择
- API 返回 `REPEAT_ASK_DOING_NOT_OPERATE` 表示相同任务已在运行，建议用户等待
- **Token 完全由 `auth.py` 自动管理**，无需手动传入
- **所有接口调用（入参、原始响应）均不向用户展示**，只输出处理后的结论性内容
- 视频生成耗时较长，轮询时需耐心等待
