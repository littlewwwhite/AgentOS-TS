'use client'

import { useEffect, useMemo, useState } from 'react'

import { AgentOsFileBrowser } from '@/components/agentos-file-browser'
import { AgentOsFilePreview } from '@/components/agentos-file-preview'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAgentOsFileTree } from '@/hooks/use-agentos-file-tree'
import { findFirstFilePath } from '@/lib/agentos-file-tree'
import { getPreviewKind, hasRenderedPreview, shouldUseFragmentCode } from '@/lib/preview'

export function AgentOsWorkspace({
  projectId,
}: {
  projectId: string
}) {
  const [selectedTab, setSelectedTab] = useState<'code' | 'preview'>('code')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const { tree, rootPath, loading, error, refresh } = useAgentOsFileTree(projectId)

  const firstFilePath = useMemo(() => findFirstFilePath(tree), [tree])

  const relativePath = useMemo(() => {
    if (!selectedPath) return null
    if (rootPath && selectedPath.startsWith(rootPath)) {
      const rel = selectedPath.slice(rootPath.length)
      return rel.startsWith('/') ? rel.slice(1) : rel
    }
    return selectedPath
  }, [selectedPath, rootPath])

  useEffect(() => {
    if (!selectedPath) {
      setSelectedPath(firstFilePath)
      return
    }

    if (
      firstFilePath &&
      !tree.some((node) => selectedPath.startsWith(node.path))
    ) {
      setSelectedPath(firstFilePath)
    }
  }, [firstFilePath, selectedPath, tree])

  // Auto-select the best tab based on file type
  useEffect(() => {
    if (!selectedPath) return
    const kind = getPreviewKind(selectedPath)
    if (shouldUseFragmentCode(kind)) {
      setSelectedTab('code')
    } else if (hasRenderedPreview(kind)) {
      setSelectedTab('preview')
    }
  }, [selectedPath])

  return (
    <div className="relative h-full w-full overflow-hidden bg-popover shadow-2xl md:rounded-bl-3xl md:rounded-tl-3xl md:border-l md:border-y">
      <div className="flex h-full flex-col">
        {/* Header: tabs centered */}
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
          <Tabs
            value={selectedTab}
            onValueChange={(value) =>
              setSelectedTab(value as 'code' | 'preview')
            }
            className="h-8"
          >
            <TabsList className="border px-1 py-0">
              <TabsTrigger
                className="px-2 py-1 text-xs font-normal"
                value="code"
              >
                Code
              </TabsTrigger>
              <TabsTrigger
                className="px-2 py-1 text-xs font-normal"
                value="preview"
              >
                Preview
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="min-w-0 max-w-[50%] text-right font-mono text-[11px] text-muted-foreground truncate" title={selectedPath ?? ''}>
            {relativePath ?? ''}
          </div>
        </div>

        {/* Body: file browser + preview */}
        <div className="min-h-0 flex-1 grid grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
          <AgentOsFileBrowser
            nodes={tree}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
            onRefresh={refresh}
            loading={loading}
            error={error}
            rootPath={rootPath}
          />
          <div className="min-h-0 overflow-hidden">
            <AgentOsFilePreview
              projectId={projectId}
              selectedPath={selectedPath}
              mode={selectedTab}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
