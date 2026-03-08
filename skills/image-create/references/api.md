# 图片生成 API 文档

## Base URL

```
https://animeworkbench-pre.lingjingai.cn
```

所有请求均需携带鉴权 Header。

---

## 0. 获取可用生图模型列表（必须先调用）

**POST** `/api/resource/model/list/usage/IMAGE_CREATE`

无需请求体（空 body 即可）。

### 响应结构

```json
{
  "code": 200,
  "msg": "success",
  "data": [
    {
      "modelCode": "model_xxx",
      "modelName": "模型名称",
      "modelDesc": "模型描述",
      "modelLogo": "https://...",
      "modelVersion": "v1.0",
      "componyName": "公司名称",
      "usage": "IMAGE_CREATE",
      "rank": 1,
      "maxUse": 10,
      "feeCalcType": "FIXED",
      "pointNo": 10,
      "modelStatus": "ENABLE",
      "modelParams": [
        {
          "paramKey": "style",
          "paramName": "风格",
          "paramType": "ENUM",
          "rank": 1,
          "hasConstraint": 1,
          "optionList": [
            { "enumName": "动漫风", "enumValue": "anime", "rank": 1, "available": true },
            { "enumName": "写实风", "enumValue": "realistic", "rank": 2, "available": true }
          ],
          "rules": {}
        },
        {
          "paramKey": "width",
          "paramName": "宽度",
          "paramType": "INT",
          "rank": 2,
          "hasConstraint": 1,
          "optionList": null,
          "rules": { "min": 512, "max": 2048, "default": 1024 }
        }
      ]
    }
  ]
}
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `modelCode` | 模型编码，生成接口的必填参数 |
| `modelName` | 展示给用户的模型名称 |
| `modelParams` | 该模型支持的参数列表，需逐一引导用户填写 |

### modelParams 参数类型（paramType）

| paramType | 含义 | 取值方式 |
|-----------|------|---------|
| `ENUM` | 枚举选择 | 从 `optionList` 中选择 `enumValue`（`available: true` 的项） |
| `INT` | 整数 | 参考 `rules.min` / `rules.max` / `rules.default` |
| `FLOAT` | 浮点数 | 参考 `rules.min` / `rules.max` / `rules.default` |
| `STRING` | 字符串 | 自由输入，参考 `rules` 中的约束 |

### curl 示例

```bash
curl -X POST "https://animeworkbench-pre.lingjingai.cn/api/resource/model/list/usage/IMAGE_CREATE" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json"
```

---

## 1. 提交图片生成任务

**POST** `/creation/imageCreate`

### 请求体 (JSON)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| modelCode | string | 是 | 模型编码（从模型列表接口获取） |
| handleCode | string | 否 | 处理器编码 |
| taskPrompt | string | 是 | 提示词 |
| promptParams | JSONObject | 否 | 提示词参数（模型 modelParams 中 paramKey 对应的键值对） |
| customBizId | string | 否 | 自定义业务ID |
| canvasParams | JSONObject | 否 | 画布参数（尺寸比例等） |
| pointNo | long | 否 | 积分（由费用计算接口获取） |
| bizScenarioParams | JSONObject | 否 | 业务场景参数 |

> `promptParams` 说明：将用户选择/填写的 modelParams 结果，以 `{ "paramKey": "paramValue" }` 格式组装为 JSONObject 传入。

### 响应

```json
{
  "code": 200,
  "msg": "success",
  "data": "task_id_xxxxxxxx"
}
```

`data` 字段即为 `taskId`，用于后续查询。

### curl 示例

```bash
curl -X POST "https://animeworkbench-pre.lingjingai.cn/creation/imageCreate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TOKEN}" \
  -d '{
    "modelCode": "model_xxx",
    "taskPrompt": "一只可爱的猫咪，吉卜力风格",
    "promptParams": {
      "style": "anime",
      "width": 1024,
      "height": 1024
    }
  }'
```

---

## 2. 查询任务状态

**GET** `/creation/imageCreateGet?taskId={taskId}`

### 响应

```json
{
  "code": 200,
  "data": {
    "taskId": "task_id_xxxxxxxx",
    "taskStatus": "SUCCESS",
    "taskQueueNum": 0,
    "resultFileList": ["https://cdn.example.com/image1.png"],
    "resultFileDisplayList": ["https://cdn.example.com/image1_display.png"],
    "errorMsg": null
  }
}
```

### 任务状态说明

| 状态 | 含义 |
|------|------|
| WAITING | 等待中（在队列中） |
| SENDED | 已发送给处理服务 |
| PROCESSING | 处理中 |
| SUCCESS | 成功，可取 resultFileList |
| FAIL | 失败，可取 errorMsg |

### curl 示例

```bash
curl "https://animeworkbench-pre.lingjingai.cn/creation/imageCreateGet?taskId={TASK_ID}" \
  -H "Authorization: Bearer {TOKEN}"
```

---

## 3. 积分计算（可选，提交前预估）

**POST** `/creation/imageCreateFeeCalc`

请求体与 `/creation/imageCreate` 相同，响应 `data` 为所需积分数（long）。

### curl 示例

```bash
curl -X POST "https://animeworkbench-pre.lingjingai.cn/creation/imageCreateFeeCalc" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TOKEN}" \
  -d '{
    "modelCode": "model_xxx",
    "taskPrompt": "一只可爱的猫咪",
    "promptParams": {}
  }'
```

---

## 通用响应结构

```json
{
  "code": 200,
  "msg": "success",
  "data": ...
}
```

常见错误码：
- `REPEAT_ASK_DOING_NOT_OPERATE`：已有同类任务处理中，不可重复提交
- `TASK_DOING_NOT_OPERATE`：任务处理中，不可删除
- `TASK_NOT_FOUND`：任务不存在
