export type PreviewKind =
  | "empty"
  | "image"
  | "video"
  | "json"
  | "markdown"
  | "text";

export function getPreviewKind(filePath: string | null): PreviewKind {
  if (!filePath) {
    return "empty";
  }

  const extension = filePath.split(".").pop()?.toLowerCase();
  if (!extension) {
    return "text";
  }

  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    return "image";
  }

  if (["mp4", "webm", "mov"].includes(extension)) {
    return "video";
  }

  if (extension === "json") {
    return "json";
  }

  if (["md", "markdown"].includes(extension)) {
    return "markdown";
  }

  return "text";
}

export function shouldUseFragmentCode(kind: PreviewKind): boolean {
  return kind === "text" || kind === "json" || kind === "markdown";
}

export function hasRenderedPreview(kind: PreviewKind): boolean {
  return kind === "markdown" || kind === "image" || kind === "video";
}

export function getLeafName(filePath: string | null): string {
  if (!filePath) {
    return "No file selected";
  }

  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}
