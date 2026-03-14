# src/tools/awb

AnimeWorkBench (AWB) 平台的 API 基础设施，以 MCP 工具形式封装，供 Agent 调用。

## 文件清单

| 文件 | 地位 | 功能 |
|:-----|:-----|:-----|
| `auth.ts` | 认证基础层 | token 生命周期管理（缓存/刷新/持久化）+ 通用 API 请求函数 `apiRequest`（含 701 自动重试）；读写 `~/.animeworkbench_auth.json` |
| `cos.ts` | COS 上传层 | 从 AWB 后端获取临时 COS 凭证，构造 SHA1 签名，PUT 文件到腾讯 COS 并返回公开访问 URL |
| `index.ts` | MCP 工具入口 | 定义并导出 6 个 MCP 工具：`awb_get_auth`、`awb_login`、`awb_upload`、`awb_submit_task`、`awb_poll_task`、`awb_api_request` |
