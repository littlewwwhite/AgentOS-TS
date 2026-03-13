# Prompt Parameters Type Specification

modelParams 中各参数类型的解析规则与组装方式。

---

## ENUM 类型

`paramType` 含 `Enum`：列出 `optionList` 中 `available: true` 的选项（显示 `enumName`，取值 `enumValue`）。

## INT / FLOAT / LONG 类型

告知用户 `rules.min`、`rules.max`、`rules.default`。

## BOOLEAN 类型

提示用户填 `true` 或 `false`，参考 `rules.default`。

## STRING / Prompt 类型

提示用户自由输入，参考 `rules` 中约束。`Prompt` 类型通常对应 `taskPrompt`，可直接使用用户已提供的提示词。

---

## FileListType

文件 URL 列表（参考图或参考视频），**通常必填**。若用户提供本地文件路径，执行**步骤 4.5** 上传后取得 URL；若已有公开 URL，直接使用。

---

## FrameListType

首尾帧参数（`paramType: "FrameListType"`），用于图生视频。格式为 JSON 数组，每个元素是一个帧对象：

```json
[
  {
    "url": "https://...cos_url...webp",
    "text": "提示词",
    "time": "5"
  }
]
```

- index 0 = **首帧**（first frame）
- index 1 = **尾帧**（last frame），仅当 `rules.supportLastFrame: true` 时可用
- `text` 字段作为视频生成 prompt，可与 `taskPrompt` 保持一致
- `time` 字段值会覆盖 `generated_time` 参数
- 若用户提供本地文件，执行**步骤 4.5** 上传后取得 URL；`rules.supportedFileTypes` 指定支持格式（如 `["webp"]`）

**FrameListType 完整组装示例**（首帧图生视频）：

```json
{
  "quality": "720",
  "frames": [
    {
      "url": "https://huimeng-1351980869.cos.ap-beijing.myqcloud.com/material/video-create/.../upload-xxx.webp",
      "text": "美女跑起来",
      "time": "5"
    }
  ]
}
```

---

## multi_prompt（多分镜）

仅当模型为 **可灵3.0** 或 **可灵3.0-Omni** 且用户选择了多分镜模式时使用：

```json
"multi_prompt": [
    {"index": 1, "prompt": "第一个分镜的描述", "duration": "5"},
    {"index": 2, "prompt": "第二个分镜的描述", "duration": "5"}
]
```

规则：
- `index`：分镜序号（**从 1 开始**）
- `prompt`：该分镜提示词，最大长度 512
- `duration`：该分镜时长（秒），不大于总时长，不小于 1
- 最多 **6** 个分镜，最少 **1** 个
- **所有分镜的 `duration` 之和必须等于任务总时长**

**可灵3.0 完整 promptParams 组装示例**（多分镜 + 首帧图生视频）：

```json
{
    "quality": "720",
    "generated_time": "10",
    "frames": [
        {
            "url": "/material/video-create/.../upload-xxx.webp",
            "text": "首帧提示词",
            "time": "10"
        }
    ],
    "prompt": "",
    "reference_video": false,
    "audio": false,
    "multi_param": [],
    "multi_prompt": [
        {"index": 1, "prompt": "第一个分镜描述", "duration": "5"},
        {"index": 2, "prompt": "第二个分镜描述", "duration": "5"}
    ],
    "richTaskPrompt": ""
}
```

> **注意**：
> - `frames[].url` 使用 COS **相对路径**（去掉域名部分，如 `/material/video-create/...`），而非完整 URL
> - `frames[].time` 应等于任务总时长（`generated_time`）
> - 使用多分镜时 `taskPrompt` 传空字符串，各分镜提示词通过 `multi_prompt[].prompt` 分别指定
> - `reference_video`、`audio`、`multi_param`、`richTaskPrompt` 等字段需一并传入（无特殊需求时用默认值）
> - 多分镜模式**必须配合 `frames`（首帧图片）使用**，纯文生视频不支持多分镜

---

## promptParams 组装规则

将用户确认结果组装为 `promptParams` JSON 字符串。若某参数用户不填且 `rules` 中有 `default`，使用默认值；无默认值且用户不填则不传该 key。
