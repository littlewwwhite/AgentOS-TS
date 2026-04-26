// input: production object identity and viewer kind
// output: director/producer-facing labels and decision scope copy
// pos: UI translation layer that keeps storage paths and internal scope terms out of visible chrome

import type { ViewKind } from "../types";
import { getEditPolicy } from "./editPolicy";
import type { AssetType, EpisodeArtifactRole, ProductionObject } from "./productionObject";

export interface ProductionObjectUiCopy {
  objectKind: string;
  scopeLine: string;
  boundaryLine?: string;
}

export function getProductionObjectUiTitle(object: ProductionObject): string {
  switch (object.type) {
    case "project": return object.projectId ?? "项目";
    case "script": return "剧本";
    case "asset": return object.assetId ? `${assetTypeLabel(object.assetType)} · ${object.assetId}` : `${assetTypeLabel(object.assetType)}库`;
    case "episode": return object.artifactRole ? `${object.episodeId} · ${episodeRoleLabel(object.artifactRole)}` : object.episodeId;
    case "scene": return `${object.episodeId} · ${object.sceneId}`;
    case "shot": return [object.episodeId, object.sceneId, object.shotId].filter(Boolean).join(" · ");
    case "artifact": return "当前产物";
  }
}

export function getViewKindUiLabel(kind: ViewKind): string {
  switch (kind) {
    case "overview": return "制作总览";
    case "script": return "剧本";
    case "storyboard": return "故事板";
    case "asset-gallery": return "素材库";
    case "video-grid": return "视频集";
    case "image": return "图片";
    case "video": return "视频";
    case "text": return "文档";
    case "json": return "数据";
    default: return "产物";
  }
}

export function getEditImpactUiLabel(path: string): string | null {
  const policy = getEditPolicy(path);
  if (!policy) return null;
  return policy.invalidateStages.length > 0 ? "保存后需重新审核下游制作" : "保存后进入审核";
}

export function getProductionObjectUiCopy(object: ProductionObject): ProductionObjectUiCopy {
  switch (object.type) {
    case "project":
      return {
        objectKind: "项目",
        scopeLine: "默认面向全片制作推进",
        boundaryLine: "跨阶段改动会先确认",
      };
    case "script":
      return {
        objectKind: "剧本",
        scopeLine: "默认只改剧本定稿",
        boundaryLine: "不直接重做视觉素材、分镜或视频",
      };
    case "asset": {
      const assetType = assetTypeLabel(object.assetType);
      return {
        objectKind: object.assetId ? assetType : `${assetType}库`,
        scopeLine: object.assetId ? `默认只改当前${assetType}` : `默认只改${assetType}库`,
        boundaryLine: "不改剧本文本",
      };
    }
    case "episode": {
      const role = object.artifactRole ? episodeRoleLabel(object.artifactRole) : "制作内容";
      return {
        objectKind: `${object.episodeId} 分集`,
        scopeLine: `默认只改 ${object.episodeId} 的${role}`,
        boundaryLine: "不影响其他分集",
      };
    }
    case "scene":
      return {
        objectKind: "场次",
        scopeLine: "默认只改当前场次",
        boundaryLine: "不影响其他场次",
      };
    case "shot":
      return {
        objectKind: "镜头",
        scopeLine: "默认只改当前镜头",
        boundaryLine: "不改剧本、分镜定稿和登记素材",
      };
    case "artifact":
      return {
        objectKind: "产物",
        scopeLine: "默认只处理当前打开的产物",
        boundaryLine: "不扩散到其他产物",
      };
  }
}

function assetTypeLabel(assetType: AssetType): string {
  switch (assetType) {
    case "actor": return "角色";
    case "location": return "场景";
    case "prop": return "道具";
  }
}

function episodeRoleLabel(role: EpisodeArtifactRole): string {
  switch (role) {
    case "storyboard": return "故事板";
    case "video": return "视频";
    case "editing": return "剪辑";
    case "music": return "配乐";
    case "subtitle": return "字幕";
    case "delivery": return "交付包";
  }
}
