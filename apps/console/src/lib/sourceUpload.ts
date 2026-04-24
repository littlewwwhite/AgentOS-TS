const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

export function sanitizeUploadFilename(filename: string): string {
  const leaf = filename
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.normalize("NFKC")
    .trim();

  const safe = (leaf ?? "")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 160)
    .trim();

  return safe || "source.txt";
}

export function isTextSourceUpload(filename: string, contentType?: string | null): boolean {
  const normalizedType = (contentType ?? "").toLowerCase();
  return normalizedType.startsWith("text/") || TEXT_EXTENSIONS.has(extensionOf(filename));
}

export function buildSourceUploadTargets(filename: string, contentType?: string | null): {
  rawPath: string;
  sourcePath?: string;
} {
  const safeName = sanitizeUploadFilename(filename);
  return {
    rawPath: `input/${safeName}`,
    sourcePath: isTextSourceUpload(safeName, contentType) ? "source.txt" : undefined,
  };
}
