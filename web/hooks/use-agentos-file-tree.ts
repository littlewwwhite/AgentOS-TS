'use client'

import { useCallback, useEffect, useState } from 'react'

import { agentOsFetch } from '@/lib/agentos'
import {
  AgentOsFileTreeEntry,
  AgentOsFileTreeNode,
  buildAgentOsFileTree,
} from '@/lib/agentos-file-tree'

const DEFAULT_WORKSPACE_ROOT =
  process.env.NEXT_PUBLIC_AGENTOS_WORKSPACE_ROOT ?? '/home/user/app/workspace'

export function useAgentOsFileTree(projectId: string) {
  const [tree, setTree] = useState<AgentOsFileTreeNode[]>([])
  const [rootPath, setRootPath] = useState(DEFAULT_WORKSPACE_ROOT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await agentOsFetch(
        `/api/projects/${encodeURIComponent(projectId)}/files/tree?path=${encodeURIComponent(rootPath)}`,
        { cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error(`Failed to load file tree (${response.status})`)
      }

      const payload = (await response.json()) as {
        root: string
        entries: AgentOsFileTreeEntry[]
      }
      setRootPath(payload.root)
      setTree(buildAgentOsFileTree(payload.entries, payload.root))
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : String(fetchError),
      )
    } finally {
      setLoading(false)
    }
  }, [projectId, rootPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    tree,
    rootPath,
    loading,
    error,
    refresh,
  }
}
