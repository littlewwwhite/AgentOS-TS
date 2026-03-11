'use client'

import { useEffect, useMemo, useState } from 'react'

import { FragmentCode } from '@/components/fragment-code'
import { agentOsFetch, getAgentOsServerBaseUrl } from '@/lib/agentos'
import {
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
      <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Select a workspace file to inspect it.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-5 py-8 text-sm text-muted-foreground">
        Loading {mode === 'code' ? 'code' : 'preview'}...
      </div>
    )
  }

  if (error) {
    return <div className="px-5 py-8 text-sm text-red-400">{error}</div>
  }

  if (mode === 'code') {
    if (!shouldUseFragmentCode(previewKind)) {
      return (
        <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Code view is available for text, markdown, and JSON files.
        </div>
      )
    }

    return <FragmentCode files={codeFiles} />
  }

  if (previewKind === 'markdown') {
    return (
      <article className="h-full overflow-y-auto px-5 py-5 text-sm leading-7 text-foreground">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-foreground">
          {content}
        </pre>
      </article>
    )
  }

  if (previewKind === 'image' && downloadUrl) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-4">
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
      <div className="h-full overflow-auto p-4">
        <video
          src={downloadUrl}
          controls
          className="mx-auto max-h-full w-full rounded-lg"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {hasRenderedPreview(previewKind)
        ? 'Preview is not available yet.'
        : 'Preview is only available for markdown, image, and video files.'}
    </div>
  )
}
