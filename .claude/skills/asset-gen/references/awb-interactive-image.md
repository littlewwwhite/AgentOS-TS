# AWB 交互式图片 API 参考

适用于单张图片的用户交互式生成（imageCreate）与编辑（imageEdit）工作流，均通过 AWB MCP 工具完成，无需 Python 脚本。

---

## 1. 认证（共用）

```
awb_get_auth → { token, groupId }
```

若失败，引导用户打开 `https://animeworkbench-pre.lingjingai.cn/home` 获取验证码，然后：

```
awb_login(action='phone_login', phone=..., code=...)
# 多团队时展示列表让用户选择
awb_login(action='select_group', groupId=...)
```

---

## 2. 模型列表（每会话仅请求一次，结果缓存）

**imageCreate：**
```
awb_api_request(path="/api/resource/model/list/usage/IMAGE_CREATE", method="POST", body={})
```

**imageEdit：**
```
awb_api_request(path="/api/resource/model/list/usage/IMAGE_EDIT", method="POST", body={})
```

过滤 `isDeleted == 0` 的条目展示给用户。每个模型含：
- `modelCode` — 提交任务必需
- `handleCode` — imageEdit 部分模型需要
- `modelParams` — 参数定义列表

---

## 3. 模型选择（强制规则）

**必须由用户明确选择，禁止假设默认值。**

---

## 4. 参数组装（共用）

根据 `modelParams[].type` 组装 `promptParams`：

| type | 取值规则 |
|:-----|:---------|
| `ENUM` | 从 `optionList`（`available: true`）中选 `enumValue` |
| `INT` / `FLOAT` / `LONG` | 参考 `rules.min` / `rules.max` / `rules.default` |
| `BOOLEAN` | `true` / `false`，参考 `rules.default` |
| `STRING` | 用户自由输入 |
| `Prompt` | 正向提示词文本 |
| `FileListType` | 文件 URL；**本地文件须先上传** |

---

## 5. 文件上传（imageEdit 及含 FileListType 参数时）

本地文件 → COS URL：
```
awb_upload(file_path="/abs/path/to/file.png")
→ { url: "https://...", relativePath: "material/..." }
```

- `imageEdit` 的 `element-frontal-image` 须使用 `relativePath`（相对路径），不是完整 URL
- 其他 `FileListType` 参数使用完整 `url`

---

## 6. 提交任务

**imageCreate：**
```
awb_submit_task(
  task_type='imageCreate',
  model_code=modelCode,
  prompt_params=promptParams   # 含 Prompt 等参数
)
→ { taskId }
```

**imageEdit：**
```
awb_submit_task(
  task_type='imageEdit',
  model_code=modelCode,
  handle_code=handleCode,      # 若模型有 handleCode
  prompt_params=promptParams   # 含 FileListType 等参数
)
→ { taskId }
```

---

## 7. 轮询结果（共用）

```
awb_poll_task(task_type='imageCreate'|'imageEdit', task_id=taskId)
# 内部每 3 秒查询一次，直至 SUCCESS 或 FAIL
```

- 成功：从 `resultFileList` 取图片 URL 展示给用户
- 失败：展示 `errorMsg`

---

## 关键规则

- 模型列表全会话只请求一次，缓存复用
- `isDeleted == 1` 的模型不展示、不使用
- `REPEAT_ASK_DOING_NOT_OPERATE` 错误 → 告知用户同类任务已在运行，等待完成后重试
- 接口原始入参和响应不向用户展示，只输出结论性内容（URL、错误原因等）
