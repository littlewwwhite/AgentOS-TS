'use client'

import { useState } from 'react'
import { AgentDetail } from '@/lib/agentos-protocol'
import { ProjectSession } from '@/lib/agentos'
import { cn } from '@/lib/utils'

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function AgentOsInfoPanel({
  sessions,
  agents,
  currentProjectId,
  onResumeSession,
  onSwitchAgent,
}: {
  sessions: ProjectSession[]
  agents: Record<string, AgentDetail>
  currentProjectId: string
  onResumeSession: (sessionId: string) => void
  onSwitchAgent: (agent: string) => void
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden border-r bg-background">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <SessionList
          sessions={sessions}
          currentProjectId={currentProjectId}
          onResumeSession={onResumeSession}
        />
        <AgentList agents={agents} onSwitchAgent={onSwitchAgent} />
      </div>
    </div>
  )
}

function SessionList({
  sessions,
  currentProjectId,
  onResumeSession,
}: {
  sessions: ProjectSession[]
  currentProjectId: string
  onResumeSession: (sessionId: string) => void
}) {
  if (sessions.length === 0) {
    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sessions
        </h3>
        <p className="text-xs text-muted-foreground/60">No sessions yet</p>
      </section>
    )
  }

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Sessions
      </h3>
      <div className="space-y-1">
        {sessions.map((s) => {
          const isCurrent = s.projectId === currentProjectId
          const mainSessionId = s.agentSessionIds?.main
          return (
            <button
              key={s.projectId}
              type="button"
              disabled={isCurrent || !mainSessionId}
              onClick={() => mainSessionId && onResumeSession(mainSessionId)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                isCurrent
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                !isCurrent && !mainSessionId && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span
                className={cn(
                  'mt-1 inline-block h-2 w-2 shrink-0 rounded-full',
                  isCurrent ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {s.projectId}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                  <span>{formatTimeAgo(s.updatedAt)}</span>
                  {s.activeAgent && (
                    <span className="truncate">agent: {s.activeAgent}</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AgentList({
  agents,
  onSwitchAgent,
}: {
  agents: Record<string, AgentDetail>
  onSwitchAgent: (agent: string) => void
}) {
  const entries = Object.entries(agents)
  if (entries.length === 0) {
    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agents
        </h3>
        <p className="text-xs text-muted-foreground/60">No agents loaded</p>
      </section>
    )
  }

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Agents
      </h3>
      <div className="space-y-1">
        {entries.map(([name, detail]) => (
          <AgentCard
            key={name}
            name={name}
            detail={detail}
            onSwitch={() => onSwitchAgent(name)}
          />
        ))}
      </div>
    </section>
  )
}

function AgentCard({
  name,
  detail,
  onSwitch,
}: {
  name: string
  detail: AgentDetail
  onSwitch: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border bg-card text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="text-[10px] text-muted-foreground">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="font-medium text-foreground">{name}</span>
      </button>
      {expanded && (
        <div className="border-t px-2 py-1.5 space-y-1.5">
          <p className="text-muted-foreground">{detail.description}</p>
          {detail.skills && detail.skills.length > 0 && (
            <div>
              <span className="font-medium text-foreground/80">Skills: </span>
              <span className="text-muted-foreground">
                {detail.skills.join(', ')}
              </span>
            </div>
          )}
          {detail.mcpServers && detail.mcpServers.length > 0 && (
            <div>
              <span className="font-medium text-foreground/80">MCP: </span>
              <span className="text-muted-foreground">
                {detail.mcpServers.join(', ')}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSwitch()
            }}
            className="mt-1 rounded border px-2 py-0.5 text-[10px] font-medium hover:bg-accent transition-colors"
          >
            Switch to {name}
          </button>
        </div>
      )}
    </div>
  )
}
