# create-subject API Specification

## 请求参数

### 创建主体参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| elementName | String | **是** | 主体名称，不能为空 |
| elementDescription | String | **是** | 主体描述文本 |
| modelCode | String | 否 | 模型编码（如 `tx`） |
| elementFrontalImage | String | **条件必填** | 主体正面图片URL（`referenceType` 为 `image_refer` 时必填） |
| referenceType | String | 否 | 参考类型：`image_refer` 或 `video_refer` |
| elementReferList | List | **条件必填** | 参考资源列表，格式 `[{"imageUrl":"..."}]`（`image_refer` 时必填） |
| elementVideoList | List | **条件必填** | 参考视频列表，格式 `[{"videoUrl":"..."}]`（`video_refer` 时必填） |
| elementVoiceId | String | 否 | 音色ID（externalId，通过 `list-voices` 获取） |
| tagList | List | 否 | 标签列表，格式 `[{"tagId":"..."}]` |
| reqTaskId | String | 否 | 请求任务ID（UUID格式），用于幂等和查询结果 |

### reference_type 详细说明

**`image_refer`** — 使用图片作为参考：
- 必须提供 `elementFrontalImage`（正面图片相对路径）
- 必须提供 `elementReferList`（参考图片列表）
- 当仅提供 `elementFrontalImage` 时，脚本会自动填充 `elementReferList`

```json
{
  "referenceType": "image_refer",
  "elementFrontalImage": "material/image-edit/xxx/image.png",
  "elementReferList": [
    {"imageUrl": "material/image-edit/xxx/image.png"}
  ]
}
```

**`video_refer`** — 使用视频作为参考：
- 必须提供 `elementVideoList`（参考视频列表）

```json
{
  "referenceType": "video_refer",
  "elementVideoList": [
    {"videoUrl": "https://example.com/video.mp4"}
  ]
}
```

### 创建音色参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| voiceName | String | **是** | 音色名称 |
| voiceUrl | String | 二选一 | 音色URL |
| videoId | String | 二选一 | 视频ID |
| reqTaskId | String | 否 | 请求任务ID（UUID格式） |

## 响应格式

成功响应：
```json
{
  "code": 200,
  "msg": "OK",
  "data": "<task_id>"
}
```

主体已存在（自动去重）：
```json
{
  "code": 200,
  "msg": "主体已存在",
  "data": {
    "id": "2030939638013960193",
    "elementName": "白行风",
    "elementDescription": "...",
    "externalId": "..."
  }
}
```

音色列表返回示例：
```json
{
  "code": 200,
  "msg": "OK",
  "data": [
    {
      "id": 1,
      "voiceName": "角色A音色",
      "voiceUrl": "https://...",
      "externalId": "ext_voice_12345"
    }
  ]
}
```

## 代码层面的关键文件

当需要修改或扩展创建主体功能时，涉及的后端关键文件：

| 层级 | 文件 | 说明 |
|------|------|------|
| Controller | `web/controller/MaterialCreationElementController.java` | 请求入口 |
| Request DTO | `application/creation/request/ElementCreateWebCmd.java` | 请求参数定义 |
| Application | `application/creation/MaterialCreationElementApplication.java` | 业务编排 |
| Factory | `application/factory/CommonTaskFactory.java` | 异步任务构建（`elementCreate` 方法） |
| Entity | `domain/entity/ElementEntity.java` | 领域实体 |
| Repository | `domain/repository/ElementRepository.java` | 仓储接口 |
| Repository Impl | `application/repository/ElementRepositoryImpl.java` | 仓储实现 |
| DO | `common/dal/data/ElementDO.java` | 数据对象（表 `public.mc_element`） |
| Convertor | `common/dal/convertor/ElementConvertor.java` | Entity <-> DO 转换 |
| VO | `application/common/vo/ElementVO.java` | 响应视图对象 |

## 处理流程说明

1. Controller 接收 `ElementCreateWebCmd` 请求
2. Application 层校验参数（`elementName` 必填）
3. `CommonTaskFactory.elementCreate()` 构建异步任务实体，`handlerCode` 为 `elementCreateHandler`
4. `MaterialCreationCommonTaskService.accept()` 任务落表
5. `MaterialCreationCommonTaskService.process()` 异步调用下游执行
6. 同时将 `ElementEntity` 保存到数据库（`externalId` 待异步回调更新）
7. 返回任务 ID
