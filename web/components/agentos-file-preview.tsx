'use client'

import { useEffect, useMemo, useState } from 'react'

import { FragmentCode } from '@/components/fragment-code'
import { agentOsFetch, getAgentOsServerBaseUrl } from '@/lib/agentos'
import {
  PreviewKind,
  getLeafName,
  getPreviewKind,
  hasRenderedPreview,
  shouldUseFragmentCode,
} from '@/lib/preview'

export function AgentOsFilePreview({
  projectId,
  selectedPath,
  mode,
}: {
  projectId: string
  selectedPath: string | null
  mode: 'code' | 'preview'
}) {
  const previewKind = getPreviewKind(selectedPath)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedPath || previewKind === 'image' || previewKind === 'video') {
      setContent('')
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    agentOsFetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/read?path=${encodeURIComponent(selectedPath)}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to read file (${response.status})`)
        }

        const payload = (await response.json()) as { content: string }
        if (!cancelled) {
          setContent(payload.content)
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : String(fetchError),
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [previewKind, projectId, selectedPath])

  const downloadUrl = useMemo(() => {
    if (!selectedPath) {
      return null
    }

    return `${getAgentOsServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/files/download?path=${encodeURIComponent(selectedPath)}`
  }, [projectId, selectedPath])

  const renderedJson = useMemo(() => {
    if (previewKind !== 'json') {
      return null
    }

    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return content
    }
  }, [content, previewKind])

  const codeFiles = useMemo(() => {
    if (!selectedPath || !shouldUseFragmentCode(previewKind)) {
      return []
    }

    return [
      {
        name: getLeafName(selectedPath),
        content: previewKind === 'json' ? renderedJson ?? content : content,
      },
    ]
  }, [content, previewKind, renderedJson, selectedPath])

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        Select a file to view
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-xs text-red-400">
        {error}
      </div>
    )
  }

  // --- Code mode ---
  if (mode === 'code') {
    // For non-text files (image/video), fall back to preview rendering
    if (!shouldUseFragmentCode(previewKind)) {
      return renderPreview(previewKind, content, downloadUrl, selectedPath)
    }

    return (
      <div className="h-full overflow-auto">
        <FragmentCode files={codeFiles} />
      </div>
    )
  }

  // --- Preview mode ---
  return renderPreview(previewKind, content, downloadUrl, selectedPath)
}

function renderPreview(
  previewKind: PreviewKind,
  content: string,
  downloadUrl: string | null,
  selectedPath: string,
) {
  if (previewKind === 'markdown') {
    return (
      <article className="h-full overflow-y-auto px-5 py-4">
        <div className="prose prose-sm prose-invert max-w-none text-foreground">
          <pre className="whitespace-pre-wrap border-none bg-transparent p-0 font-sans text-sm leading-7 text-foreground">
            {content}
          </pre>
        </div>
      </article>
    )
  }

  if (previewKind === 'image' && downloadUrl) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted/20 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={downloadUrl}
          alt={selectedPath}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
    )
  }

  if (previewKind === 'video' && downloadUrl) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-4">
        <video
          src={downloadUrl}
          controls
          className="max-h-full max-w-full rounded-lg"
        />
      </div>
    )
  }

  if (previewKind === 'json') {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2)
      return (
        <div className="h-full overflow-y-auto px-4 py-3">
          <pre className="font-mono text-xs leading-5 text-foreground whitespace-pre-wrap">
            {pretty}
          </pre>
        </div>
      )
    } catch {
      // fall through
    }
  }

  // Text fallback for preview mode
  if (content) {
    return (
      <div className="h-full overflow-y-auto px-4 py-3">
        <pre className="font-mono text-xs leading-5 text-foreground whitespace-pre-wrap">
          {content}
        </pre>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
      {hasRenderedPreview(previewKind)
        ? 'Preview not available.'
        : 'No preview for this file type.'}
    </div>
  )
}
