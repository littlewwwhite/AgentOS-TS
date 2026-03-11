'use client'

import { useState } from 'react'
import { AgentOsFileTreeNode } from '@/lib/agentos-file-tree'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const FILE_ICON_MAP: Record<string, string> = {
  json: '{ }',
  md: 'M',
  ts: 'TS',
  tsx: 'TX',
  js: 'JS',
  jsx: 'JX',
  py: 'PY',
  yaml: 'YA',
  yml: 'YA',
  css: 'CS',
  html: '<>',
  svg: 'SV',
}
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov'])

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return <span className="text-[9px] text-violet-400">IMG</span>
  if (VIDEO_EXTS.has(ext)) return <span className="text-[9px] text-amber-400">VID</span>
  if (FILE_ICON_MAP[ext]) return <span className="text-[9px] text-muted-foreground/80">{FILE_ICON_MAP[ext]}</span>
  return <span className="text-[9px] text-muted-foreground/50">--</span>
}

function DirIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className={cn(
      'inline-block text-[10px] text-muted-foreground/70 transition-transform',
      expanded && 'rotate-90',
    )}>
      &#x25B8;
    </span>
  )
}

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
  const [expanded, setExpanded] = useState(depth < 2)

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (isDirectory) {
            setExpanded((v) => !v)
          } else {
            onSelectPath(node.path)
          }
        }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors',
          isDirectory
            ? 'text-muted-foreground hover:bg-muted/50'
            : 'text-foreground hover:bg-muted',
          isSelected && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {isDirectory ? (
          <DirIcon expanded={expanded} />
        ) : (
          <FileIcon name={node.name} />
        )}
        <span className={cn(
          'truncate font-mono text-[11px]',
          isDirectory && 'font-medium',
        )}>
          {node.name}
        </span>
        {isDirectory && node.children.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground/40">
            {node.children.length}
          </span>
        )}
      </button>
      {isDirectory && expanded && node.children.length > 0 && (
        <ul>
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
      )}
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
      <div className="flex shrink-0 items-center justify-between gap-1 border-b px-2 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-medium text-foreground" title={rootPath}>
            {rootPath.split('/').pop() || rootPath}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-6 w-6 p-0 text-[10px] text-muted-foreground"
          title="Refresh"
        >
          &#x21bb;
        </Button>
      </div>

      {loading ? (
        <div className="px-3 py-6 text-xs text-muted-foreground">
          Loading...
        </div>
      ) : error ? (
        <div className="px-3 py-6 text-xs text-red-400">{error}</div>
      ) : nodes.length === 0 ? (
        <div className="px-3 py-6 text-xs text-muted-foreground">
          No files yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <ul>
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
