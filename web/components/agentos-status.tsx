'use client'

import { AgentOsBridgeState } from '@/hooks/use-agentos-bridge'
import { getEffectiveAgentOsBridgeState } from '@/lib/agentos-ui'
import { cn } from '@/lib/utils'

function getStatusLabel(state: AgentOsBridgeState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting'
    case 'connected':
      return 'Connected'
    case 'ready':
      return 'Ready'
    case 'disconnected':
      return 'Disconnected'
    case 'error':
      return 'Error'
  }
}

export function AgentOsStatus({
  state,
  sandboxStatus,
  skillsCount,
  message,
  workspaceAvailable,
  workspaceOpen,
  hasPreview,
  infoOpen,
  onToggleInfo,
  onToggleWorkspace,
  onShowPreview,
}: {
  state: AgentOsBridgeState
  sandboxStatus: 'idle' | 'busy' | 'disconnected'
  skillsCount: number
  message: string
  workspaceAvailable: boolean
  workspaceOpen: boolean
  hasPreview: boolean
  infoOpen?: boolean
  onToggleInfo?(): void
  onToggleWorkspace(): void
  onShowPreview(): void
}) {
  const effectiveState = getEffectiveAgentOsBridgeState(state, skillsCount)

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        {onToggleInfo && (
          <button
            type="button"
            className={cn(
              'rounded-full border px-2 py-0.5 transition-colors',
              infoOpen
                ? 'border-border bg-muted text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border/60 hover:text-foreground',
            )}
            onClick={onToggleInfo}
          >
            Info
          </button>
        )}
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 font-medium',
            effectiveState === 'ready' && 'border-emerald-500/40 text-emerald-500',
            effectiveState === 'connected' && 'border-sky-500/40 text-sky-500',
            effectiveState === 'connecting' && 'border-amber-500/40 text-amber-500',
            effectiveState === 'disconnected' &&
              'border-muted-foreground/30 text-muted-foreground',
            effectiveState === 'error' && 'border-red-500/40 text-red-500',
          )}
        >
          AgentOS {getStatusLabel(effectiveState)}
        </span>
        <span className="text-muted-foreground">Sandbox {sandboxStatus}</span>
        {skillsCount > 0 ? (
          <span className="text-muted-foreground">Skills {skillsCount}</span>
        ) : null}
        <span className="truncate text-muted-foreground">{message}</span>
      </div>
      <div className="flex items-center gap-2">
        {hasPreview ? (
          <button
            type="button"
            className={cn(
              'rounded-full border px-2 py-0.5 transition-colors',
              !workspaceOpen
                ? 'border-border bg-muted text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border/60 hover:text-foreground',
            )}
            onClick={onShowPreview}
          >
            Preview
          </button>
        ) : null}
        {workspaceAvailable ? (
          <button
            type="button"
            className={cn(
              'rounded-full border px-2 py-0.5 transition-colors',
              workspaceOpen
                ? 'border-border bg-muted text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border/60 hover:text-foreground',
            )}
            onClick={onToggleWorkspace}
          >
            Workspace
          </button>
        ) : null}
      </div>
    </div>
  )
}
