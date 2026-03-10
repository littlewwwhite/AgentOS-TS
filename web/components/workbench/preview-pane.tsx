"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FragmentCode } from "@/components/fragments/fragment-code";
import { Button } from "@/components/ui/button";
import { getServerBaseUrl } from "@/hooks/use-sandbox-connection";
import {
  getLeafName,
  getPreviewKind,
  shouldUseFragmentCode,
} from "@/lib/preview";

export interface PreviewPaneProps {
  projectId: string;
  selectedPath: string | null;
}

export function PreviewPane({ projectId, selectedPath }: PreviewPaneProps) {
  const previewKind = getPreviewKind(selectedPath);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !selectedPath ||
      previewKind === "image" ||
      previewKind === "video" ||
      previewKind === "empty"
    ) {
      setContent("");
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(
      `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/files/read?path=${encodeURIComponent(selectedPath)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to read file (${response.status})`);
        }
        const payload = (await response.json()) as { content: string };
        if (!cancelled) {
          setContent(payload.content);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewKind, projectId, selectedPath]);

  const downloadUrl = useMemo(() => {
    if (!selectedPath) {
      return null;
    }
    return `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/files/download?path=${encodeURIComponent(selectedPath)}`;
  }, [projectId, selectedPath]);

  const renderedJson = useMemo(() => {
    if (previewKind !== "json") {
      return null;
    }

    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }, [content, previewKind]);

  const codeFiles = useMemo(() => {
    if (!selectedPath || !shouldUseFragmentCode(previewKind)) {
      return [];
    }

    return [
      {
        name: getLeafName(selectedPath),
        content: previewKind === "json" ? renderedJson ?? content : content,
      },
    ];
  }, [content, previewKind, renderedJson, selectedPath]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between gap-2 px-2">
        <span className="truncate text-sm text-muted-foreground">
          {selectedPath ?? "Select a workspace file"}
        </span>
        {downloadUrl ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={downloadUrl} download={getLeafName(selectedPath)}>
              Download
            </a>
          </Button>
        ) : null}
      </div>

      <div className="h-full overflow-auto">
        {previewKind === "empty" ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed bg-background px-6 text-center text-sm text-muted-foreground">
            Choose a file from the Files tab to preview code, markdown, JSON, images, or video output.
          </div>
        ) : loading ? (
          <div className="rounded-xl border bg-background px-5 py-8 text-sm text-muted-foreground">
            Loading preview...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-5 py-8 text-sm text-destructive-foreground">
            {error}
          </div>
        ) : previewKind === "image" && downloadUrl ? (
          <div className="overflow-hidden rounded-xl border bg-background p-3">
            <img
              src={downloadUrl}
              alt={selectedPath ?? "preview"}
              className="mx-auto max-h-[68vh] rounded-lg object-contain"
            />
          </div>
        ) : previewKind === "video" && downloadUrl ? (
          <div className="overflow-hidden rounded-xl border bg-background p-3">
            <video src={downloadUrl} controls className="mx-auto max-h-[68vh] w-full rounded-lg" />
          </div>
        ) : previewKind === "markdown" ? (
          <article className="prose prose-invert max-w-none rounded-xl border bg-background px-5 py-5 prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-code:text-[#ff8800]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        ) : shouldUseFragmentCode(previewKind) ? (
          <div className="rounded-xl border bg-background py-2">
            <FragmentCode files={codeFiles} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
