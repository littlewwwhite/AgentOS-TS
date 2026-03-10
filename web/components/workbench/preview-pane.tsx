"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FragmentCode } from "@/components/fragments/fragment-code";
import { getServerBaseUrl } from "@/hooks/use-sandbox-connection";
import {
  getLeafName,
  getPreviewKind,
  shouldUseFragmentCode,
} from "@/lib/preview";

export interface PreviewPaneProps {
  projectId: string;
  selectedPath: string | null;
  mode: "code" | "preview";
}

export function PreviewPane({ projectId, selectedPath, mode }: PreviewPaneProps) {
  const previewKind = getPreviewKind(selectedPath);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPath || previewKind === "image" || previewKind === "video") {
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

  if (!selectedPath) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Select a workspace file to open code or preview output.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-5 py-8 text-sm text-muted-foreground">
        Loading {mode === "code" ? "code" : "preview"}...
      </div>
    );
  }

  if (error) {
    return <div className="px-5 py-8 text-sm text-red-400">{error}</div>;
  }

  if (mode === "code") {
    if (!shouldUseFragmentCode(previewKind)) {
      return (
        <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Code view is available for text, markdown, and JSON files.
        </div>
      );
    }

    return <FragmentCode files={codeFiles} />;
  }

  if (previewKind === "markdown") {
    return (
      <article className="prose prose-invert max-w-none px-5 py-5 prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-code:text-[#ff8800]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    );
  }

  if (previewKind === "image" && downloadUrl) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <img
          src={downloadUrl}
          alt={selectedPath}
          className="max-h-[68vh] rounded-lg object-contain"
        />
      </div>
    );
  }

  if (previewKind === "video" && downloadUrl) {
    return (
      <div className="p-4">
        <video src={downloadUrl} controls className="mx-auto max-h-[68vh] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
      Preview is only available for markdown, image, and video files.
    </div>
  );
}
