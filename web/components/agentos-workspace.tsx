'use client'

import { useEffect, useMemo, useState } from 'react'

import { AgentOsFileBrowser } from '@/components/agentos-file-browser'
import { AgentOsFilePreview } from '@/components/agentos-file-preview'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAgentOsFileTree } from '@/hooks/use-agentos-file-tree'
import { findFirstFilePath } from '@/lib/agentos-file-tree'

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

  return (
    <div className="relative h-full w-full overflow-hidden bg-popover shadow-2xl md:rounded-bl-3xl md:rounded-tl-3xl md:border-l md:border-y">
      <div className="flex h-full flex-col">
        <div className="grid shrink-0 grid-cols-[auto_1fr_auto] items-center border-b p-2">
          <div className="h-9 w-9" />
          <div className="flex justify-center">
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
          </div>
          <div className="min-w-0 pr-2 text-right font-mono text-[11px] text-muted-foreground truncate">
            {relativePath ?? 'No file selected'}
          </div>
        </div>
        <div className="min-h-0 flex-1 grid grid-cols-[240px_minmax(0,1fr)] overflow-hidden">
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
