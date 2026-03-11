// input: AgentOsContentBlock union type
// output: Dedicated React component per block type
// pos: Structured rendering layer replacing flat markdown for AgentOS messages

'use client'

import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  Brain,
  Terminal,
  FileText,
  Search,
  Pencil,
  Globe,
  Wrench,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Info,
  CheckCircle2,
  Loader2,
  Circle,
} from 'lucide-react'

import type { AgentOsContentBlock } from '@/lib/messages'
import type { TodoItem } from '@/lib/agentos-protocol'

// --- Utility: deterministic color from string ---

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 50%, 60%)`
}

// --- Utility: tool icon by category ---

function toolIcon(tool: string) {
  const name = tool.toLowerCase()
  if (name === 'bash') return Terminal
  if (name === 'read' || name === 'write' || name === 'edit')
    return FileText
  if (name === 'grep' || name === 'glob') return Search
  if (name.startsWith('mcp__')) return Globe
  if (name === 'notebookedit') return Pencil
  return Wrench
}

// --- Block Components ---

export function ContentBlockRenderer({
  block,
}: {
  block: AgentOsContentBlock
}) {
  switch (block.type) {
    case 'text':
      return <TextBlock text={block.text} />
    case 'thinking':
      return (
        <ThinkingBlock text={block.text} isStreaming={block.isStreaming} />
      )
    case 'tool_use':
      return (
        <ToolCallBlock
          tool={block.tool}
          label={block.label}
          input={block.input}
          nested={block.nested}
        />
      )
    case 'todo':
      return <TodoBlock todos={block.todos} />
    case 'result':
      return <ResultBlock cost={block.cost} duration_ms={block.duration_ms} />
    case 'error':
      return <ErrorBlock message={block.message} />
    case 'agent_event':
      return (
        <AgentEventBlock
          agent={block.agent}
          action={block.action}
          reason={block.reason}
        />
      )
    case 'system':
      return <SystemBlock text={block.text} />
    case 'separator':
      return <SeparatorBlock />
    default:
      return null
  }
}

function TextBlock({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className="agentos-md text-sm leading-7">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  )
}

function ThinkingBlock({
  text,
  isStreaming,
}: {
  text: string
  isStreaming: boolean
}) {
  const [isOpen, setIsOpen] = useState(isStreaming)

  // Auto-expand while streaming, allow manual toggle
  const expanded = isStreaming || isOpen

  return (
    <div className="thinking-block my-1.5">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <Brain className="w-3 h-3 shrink-0" />
        <span className="font-medium">
          {isStreaming ? 'Thinking...' : 'Thinking'}
        </span>
        {isStreaming && (
          <span className="thinking-pulse w-1.5 h-1.5 rounded-full bg-purple-400/70" />
        )}
      </button>
      {expanded && (
        <div className="thinking-content ml-5 pl-3 border-l-2 border-purple-400/20 mt-0.5 mb-1">
          <pre className="text-xs text-muted-foreground/80 whitespace-pre-wrap font-mono leading-5 max-h-[300px] overflow-y-auto">
            {text}
          </pre>
        </div>
      )}
    </div>
  )
}

function ToolCallBlock({
  tool,
  label,
  nested,
}: {
  tool: string
  label: string
  input?: Record<string, unknown>
  nested?: boolean
}) {
  const Icon = toolIcon(tool)

  return (
    <div
      className={`tool-call-block flex items-center gap-2 py-1 my-0.5 ${
        nested ? 'ml-6' : ''
      }`}
    >
      {nested && (
        <div className="tool-nesting-line w-px h-full bg-border absolute -left-3 top-0 bottom-0" />
      )}
      <div className="flex items-center justify-center w-5 h-5 rounded bg-muted shrink-0">
        <Icon className="w-3 h-3 text-muted-foreground" />
      </div>
      <span className="text-xs font-mono text-muted-foreground truncate">
        {label}
      </span>
    </div>
  )
}

function TodoBlock({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="todo-block my-2 space-y-0.5">
      {todos.map((todo) => (
        <div key={todo.id} className="flex items-start gap-2 py-0.5">
          <div className="mt-0.5 shrink-0">
            {todo.status === 'completed' && (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            )}
            {todo.status === 'in_progress' && (
              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            )}
            {todo.status === 'pending' && (
              <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />
            )}
          </div>
          <span
            className={`text-xs leading-5 ${
              todo.status === 'completed'
                ? 'text-muted-foreground line-through'
                : todo.status === 'in_progress'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
            }`}
          >
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  )
}

function ResultBlock({
  cost,
  duration_ms,
}: {
  cost: number
  duration_ms: number
}) {
  const costStr = cost > 0 ? `$${cost.toFixed(4)}` : ''
  const durationStr =
    duration_ms > 0 ? `${(duration_ms / 1000).toFixed(1)}s` : ''
  const summary = [costStr, durationStr].filter(Boolean).join(' \u00b7 ')

  if (!summary) return null

  return (
    <div className="result-bar mt-2 pt-2 border-t border-border/50">
      <span className="text-[11px] text-muted-foreground/60 float-right">
        {summary}
      </span>
      <div className="clear-both" />
    </div>
  )
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="error-block flex items-start gap-2 my-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
      <span className="text-xs text-red-400">{message}</span>
    </div>
  )
}

function AgentEventBlock({
  agent,
  action,
  reason,
}: {
  agent: string
  action: 'entered' | 'exited'
  reason?: string
}) {
  const color = useMemo(() => hashColor(agent), [agent])
  const isEnter = action === 'entered'
  const Icon = isEnter ? ArrowRight : ArrowLeft
  const label =
    isEnter && reason === 'delegation'
      ? `delegated \u2192 ${agent}`
      : isEnter
        ? `entered ${agent}`
        : reason === 'return'
          ? `returned ${agent} \u2192`
          : `exited ${agent}`

  return (
    <div className="agent-event-block flex items-center gap-1.5 my-1">
      <div
        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
          color,
        }}
      >
        <Icon className="w-3 h-3" />
        <span>{label}</span>
      </div>
    </div>
  )
}

function SystemBlock({ text }: { text: string }) {
  return (
    <div className="system-block flex items-center gap-1.5 my-1 text-[11px] text-muted-foreground/60 italic">
      <Info className="w-3 h-3 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function SeparatorBlock() {
  return <hr className="border-border/30 my-2" />
}
