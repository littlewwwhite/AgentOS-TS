# Console Usability MVP E2E Checklist

- [ ] 进入 `apps/console/` 后运行 `bun run dev`
- [ ] 打开浏览器，确认未选项目时显示“新建项目”引导页
- [ ] 创建项目 `demo-ui`
- [ ] 上传 `txt` 或 `md` 文档
- [ ] 确认生成 `workspace/demo-ui/input/<filename>`
- [ ] 确认生成 `workspace/demo-ui/source.txt`
- [ ] 确认生成 `workspace/demo-ui/pipeline-state.json`
- [ ] 确认自动进入项目总览页
- [ ] 确认总览页显示：当前状态、下一步、工作区、待审核/返修/失效
- [ ] 确认流程条只显示：输入 → 剧本 → 素材 → 分镜 → 视频
- [ ] 确认侧边栏顺序为：总览 → 输入源 → 剧本开发 → 素材（如有）→ 分集视频（如有）
- [ ] 确认侧边栏不显示：剪辑 / 配乐 / 字幕
- [ ] 在聊天区确认建议语与当前状态一致，不再出现越阶段提示
- [ ] 发送“继续推进当前项目”并确认 WebSocket 对话正常返回
