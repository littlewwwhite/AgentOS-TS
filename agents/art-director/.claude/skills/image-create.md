---
name: image-create
description: "通过 anime-material-workbench API 生成图片，支持角色、场景、道具等图片的创建与异步任务管理。"
---

# Image Create Skill

通过 anime-material-workbench 生成图片，并管理异步任务。

**Base URL（固定）：** `https://animeworkbench-pre.lingjingai.cn`

## Resources

- **API 文档**：`references/api.md` — 完整的接口规范、字段说明和示例

---

## Token 管理机制

Token 通过调用 `/api/anime/user/account/refreshToken` 接口获取（该接口在网关白名单，无需 Authorization）。认证状态持久化存储在 `~/.animeworkbench_auth.json` 中，由 `scripts/auth.py` 自动管理，无需任何手动操作。

**首次使用必须初始化认证**（详见 Workflow 步骤 0）。

---

## Workflow

### 0. 初始化认证（首次使用或会话过期时）

运行以下命令检查认证状态：

```bash
python3 ~/.claude/skills/image-create/scripts/auth.py
```

- 若输出 `userId`、`groupId`、`userName`，说明认证正常，直接进入步骤 1。
- 若报错，按以下**登录流程**引导用户完成认证：

#### 登录流程（由 Claude 主导，分步与用户交互）

**第一步：** 告知用户——
> 需要先登录才能继续。请在浏览器打开 **https://animeworkbench-pre.lingjingai.cn/home**，在登录页面输入手机号并点击"获取验证码"，收到短信后将手机号和验证码告诉我。

**第二步：** 等用户提供手机号和验证码后，执行登录：

```bash
python3 ~/.claude/skills/image-create/scripts/login.py --phone <手机号> --code <验证码>
```

**第三步：** 根据退出码处理团队选择：

- **退出码 0（单团队）**：登录完成，进入步骤 1。
- **退出码 2（多个团队）**：从输出中找到 `TEAMS_JSON:` 开头的行，解析其后的 JSON，向用户展示团队列表：
  ```
  您所在的团队列表：
  1. 团队名称  [角色]  (groupId: xxx)
  2. 团队名称  [角色]  (groupId: xxx)
  ```
  询问用户要使用哪个团队，获取其 `groupId` 后执行：
  ```bash
  python3 ~/.claude/skills/image-create/scripts/login.py --select-group <groupId>
  ```
  告知用户团队已选定，进入步骤 1。

> **注意**：团队选择完成后，`login.py` 会自动调用 `updateCurrentGroup` 接口通知服务端切换当前团队，并使用返回的新 token 更新本地配置，无需额外操作。

> **备用方式**（已有 refreshToken 时）：
> ```bash
> python3 ~/.claude/skills/image-create/scripts/login.py --refresh-token <SID> [--group-id <groupId>]
> ```

### 0.5 切换团队（已登录用户随时可用）

已登录用户在使用过程中如需切换到其他工作团队，执行以下命令：

```bash
python3 ~/.claude/skills/image-create/scripts/login.py --select-group <groupId>
```

脚本会依次完成：
1. 更新本地配置文件中的 `groupId`
2. 调用 `updateCurrentGroup` 接口通知服务端切换团队
3. **将服务端返回的新 token 自动覆盖本地缓存的旧 token**（切换团队后服务端会生成包含新 groupId 的 JWT）

切换完成后，后续所有 API 调用将自动使用新 token，无需重新登录。

### 1. 收集必要信息

向用户确认以下内容：

- `taskPrompt`：图片描述提示词（必填）

### 2. 调用模型列表接口（仅调用一次）

**只调用一次**，将完整响应保存在内存中供后续步骤使用。使用 `auth.api_request` 自动处理 token 过期重试：

```bash
python3 -c "
import sys; sys.path.insert(0, '$HOME/.claude/skills/image-create/scripts')
import auth, json
result = auth.api_request('https://animeworkbench-pre.lingjingai.cn/api/resource/model/list/usage/IMAGE_CREATE',
    data=b'{}', method='POST')
print(json.dumps(result, ensure_ascii=False))
"
```

从响应 `data` 数组中过滤出 `isDeleted == 0` 的模型，整理为如下格式展示给用户：

```
可用模型列表：
1. 即梦 4.0  (modelCode: JiMeng4_ImageCreate)
2. Midjourney v7  (modelCode: MJ_V7_ImageCreate_official)
...
```

### 3. 让用户选择模型（必须，无默认值）

- **模型选择是必填的，不能假设默认值，必须等用户明确选择后才能继续**
- 用户选定后，直接从步骤 2 缓存的响应中取出该模型的 `modelCode` 和 `modelParams`，**不发起新请求**

### 4. 展示模型参数并让用户确认

从步骤 2 的缓存中取出用户所选模型的 `modelParams`，一次性展示所有参数及可选值，请用户逐一确认或填写：

**ENUM 类型**（`paramType` 含 `Enum`）：列出 `optionList` 中 `available: true` 的选项（显示 `enumName`，取值 `enumValue`）

**INT / FLOAT / LONG 类型**：告知用户 `rules.min`、`rules.max`、`rules.default`

**BOOLEAN 类型**：提示用户填 `true` 或 `false`，参考 `rules.default`

**STRING / Prompt 类型**：提示用户自由输入，参考 `rules` 中约束；`Prompt` 类型通常对应 `taskPrompt`，可直接使用用户已提供的提示词

**FileListType**：文件 URL 列表，若用户无需上传参考图可跳过

将用户的确认结果组装为 `promptParams` JSON 字符串，若某参数用户不填且 `rules` 中有 `default`，使用默认值；无默认值且用户不填则不传该 key。

### 5. 提交图片生成任务

```bash
python3 ~/.claude/skills/image-create/scripts/submit_image_create.py \
  --model-code "MODEL_CODE" \
  --prompt "提示词" \
  --prompt-params '{"key":"value"}'
```

从输出的 `taskId:` 行取得 taskId。

### 6. 后台轮询任务状态

**必须使用 `run_in_background: true` 在后台运行轮询脚本**，这样用户无需等待，可以继续做其他事情：

```bash
# Bash 工具参数：run_in_background = true
python3 ~/.claude/skills/image-create/scripts/poll_image_task.py \
  --task-id "TASK_ID"
```

- 提交后台任务后，立即告知用户：「图片生成任务已提交，正在后台轮询中，完成后会自动通知您结果。您可以继续做其他事情。」
- 脚本自动每 3 秒查询一次，直到 `SUCCESS` 或 `FAIL`。
- 图片生成通常在 30 秒内完成，超过 5 分钟可认为异常。
- **后台任务完成后会自动通知**，届时读取输出并进入步骤 7。

### 7. 处理结果

后台轮询任务完成通知后，读取输出结果：

- **SUCCESS**：脚本输出 `结果文件：` 或 `展示文件：` 下的图片 URL，展示给用户
- **FAIL**：脚本输出 `生成失败！错误信息：`，告知用户

## Key Rules

- **模型列表接口全程只调用一次，模型信息和参数信息均从该次响应中获取，不重复请求。**
- **模型必须由用户明确选择，禁止假设或使用默认 modelCode。**
- `isDeleted == 1` 的模型不展示给用户。
- **Token 完全由 `auth.py` 自动管理**，无需手动传入或维护。
- If the API returns `REPEAT_ASK_DOING_NOT_OPERATE`, an identical task is already running; advise the user to wait.
- Always load `references/api.md` when looking up field details, error codes, or full examples.
- **所有接口调用（入参、原始响应）均不向用户展示，只输出处理后的结论性内容**（如模型列表、参数选项、taskId、图片链接等）。
