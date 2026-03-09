# Reference Video Mode Protocol

参考生视频模式（`reference_video: true`）：用户上传参考图片，在提示词中引用这些图片来生成视频。此模式下需要构建 `multi_param` 和 `richTaskPrompt` 两个结构化字段。

---

## 使用流程

1. 用户提供参考图片（本地文件或 URL），执行**步骤 4.5** 上传到 COS
2. 从上传返回的完整 URL 中提取 COS **相对路径**（去掉 `https://huimeng-1351980869.cos.ap-beijing.myqcloud.com` 域名部分）
3. 为每张图片分配显示名称（如 `图片1`、`图片2`）和唯一 `subjectNo`（格式：`ref-{13位时间戳}-{从0开始的序号}`）
4. 构建 `multi_param` 数组，每个元素对应一张参考图片
5. 将提示词拆解为 `richTaskPrompt` 结构，图片引用部分用 `image` 类型元素，文本部分用 `text` 类型元素
6. `taskPrompt` 设为提示词纯文本版本（图片引用处使用显示名称，如 `图片1 里的角色跑起来`）

---

## multi_param 结构

```json
"multi_param": [
    {
        "subjectNo": "ref-1772519580606-0",
        "subjectName": "图片1",
        "referenceType": "IMAGE",
        "resources": [
            {
                "type": "IMAGE",
                "url": "/material/video-create/{groupId}/upload-{timestamp}-{filename}"
            }
        ]
    }
]
```

- `subjectNo`：唯一标识符，格式 `ref-{13位时间戳}-{序号}`，序号从 0 开始
- `subjectName`：显示名称，如 `图片1`、`图片2`，按上传顺序编号
- `referenceType`：固定为 `"IMAGE"`
- `resources[].type`：固定为 `"IMAGE"`
- `resources[].url`：COS **相对路径**（去掉域名部分）

---

## richTaskPrompt 结构

```json
"richTaskPrompt": [
    {
        "label": "",
        "resource": [
            {
                "id": "mention-{13位时间戳}",
                "type": "image",
                "value": "ref-1772519580606-0",
                "displayName": "图片1"
            },
            {
                "id": "text-after-{13位时间戳}",
                "type": "text",
                "value": " 里的角色跑起来"
            }
        ]
    }
]
```

- `resource` 数组按提示词中出现顺序，依次包含图片引用和文本片段
- 图片引用元素：`type: "image"`，`value` 对应 `multi_param` 中的 `subjectNo`，`displayName` 对应 `subjectName`
- 文本元素：`type: "text"`，`value` 为该段文本内容
- 每个元素的 `id` 使用 `mention-{时间戳}` 或 `text-after-{时间戳}` 格式

---

## 完整 promptParams 组装示例（单张参考图片）

```json
{
    "quality": "720",
    "generated_time": "6",
    "frames": [],
    "prompt": "",
    "reference_video": true,
    "audio": false,
    "multi_param": [
        {
            "subjectNo": "ref-1772519580606-0",
            "subjectName": "图片1",
            "referenceType": "IMAGE",
            "resources": [
                {
                    "type": "IMAGE",
                    "url": "/material/video-create/5570f496efdf4bcba199606e04f0969a/upload-1772519580781-upload-1770105237074-清羽全身.webp"
                }
            ]
        }
    ],
    "richTaskPrompt": [
        {
            "label": "",
            "resource": [
                {
                    "id": "mention-1772519600308",
                    "type": "image",
                    "value": "ref-1772519580606-0",
                    "displayName": "图片1"
                },
                {
                    "id": "text-after-1772519600308",
                    "type": "text",
                    "value": " 里的角色跑起来"
                }
            ]
        }
    ]
}
```

对应请求体：
```json
{
    "modelCode": "KeLing3_VideoCreate_tencent",
    "taskPrompt": "图片1 里的角色跑起来",
    "promptParams": { "..." }
}
```

---

## 重要注意事项

- 参考生视频模式下 `reference_video` 必须设为 `true`，`frames` 传空数组 `[]`
- `multi_param` 和 `richTaskPrompt` 中的 `subjectNo` / `value` 必须一致，用于关联图片引用
- 图片 URL 使用 COS **相对路径**
- `taskPrompt` 中的图片引用使用 `subjectName`（如 `图片1`），需与 `richTaskPrompt` 中的 `displayName` 一致
- 支持多张参考图片：在 `multi_param` 中添加多个元素（序号递增），在 `richTaskPrompt` 的 `resource` 中按提示词顺序排列
- 若提示词以图片引用开头（如 `图片1 里的角色跑起来`），文本片段 `value` 以空格开头；若图片引用在中间或末尾，按实际位置拆分
