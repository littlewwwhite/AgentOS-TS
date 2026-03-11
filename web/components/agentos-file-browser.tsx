'use client'

import { Button } from '@/components/ui/button'
import { AgentOsFileTreeNode } from '@/lib/agentos-file-tree'
import { cn } from '@/lib/utils'

function FileNode({
  node,
  selectedPath,
  onSelectPath,
  depth = 0,
}: {
  node: AgentOsFileTreeNode
  selectedPath: string | null
  onSelectPath(path: string): void
  depth?: number
}) {
  const isDirectory = node.type === 'dir'
  const isSelected = selectedPath === node.path

  return (
    <li className="space-y-1">
      <button
        type="button"
        onClick={() => {
          if (!isDirectory) {
            onSelectPath(node.path)
          }
        }}
        className={cn(
          'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          isDirectory
            ? 'cursor-default text-muted-foreground'
            : 'border border-transparent text-foreground hover:bg-muted',
          isSelected && 'border-border bg-muted text-foreground',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span
          className={cn(
            'truncate font-mono text-[12px]',
            isDirectory && 'text-[11px] uppercase tracking-[0.18em]',
          )}
        >
          {node.name}
        </span>
      </button>
      {node.children.length > 0 ? (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <FileNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function AgentOsFileBrowser({
  nodes,
  selectedPath,
  onSelectPath,
  onRefresh,
  loading,
  error,
  rootPath,
}: {
  nodes: AgentOsFileTreeNode[]
  selectedPath: string | null
  onSelectPath(path: string): void
  onRefresh(): void
  loading: boolean
  error: string | null
  rootPath: string
}) {
  return (
    <section className="flex h-full min-h-0 flex-col border-r">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">Workspace</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={rootPath}>
            {rootPath.split('/').pop() || rootPath}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-8 px-2 text-xs"
        >
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="px-3 py-6 text-sm text-muted-foreground">
          Loading workspace tree...
        </div>
      ) : error ? (
        <div className="px-3 py-6 text-sm text-red-400">{error}</div>
      ) : nodes.length === 0 ? (
        <div className="px-3 py-6 text-sm text-muted-foreground">
          No workspace files available yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-1">
            {nodes.map((node) => (
              <FileNode
                key={node.path}
                node={node}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
