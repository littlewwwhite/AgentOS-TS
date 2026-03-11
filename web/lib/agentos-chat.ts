// input: AgentOsEvent stream from bridge
// output: AgentOsChatState with structured content blocks
// pos: Core state reducer converting raw events into renderable block arrays

import { AgentDetail, AgentOsEvent, TodoItem } from './agentos-protocol'
import { AgentOsContentBlock, Message } from './messages'

export type AgentOsChatState = {
  messages: Message[]
  isLoading: boolean
  status: 'idle' | 'busy' | 'disconnected'
  errorMessage: string
  lastSubmittedText: string
  sessionId: string | null
  activeAgent: string | null
  streamingAssistantIndex: number | null
  lastStreamEventType: string | null
  todos: TodoItem[]
  /** Agent name → detail, populated from `skills` event */
  agents: Record<string, AgentDetail>
}

export function createInitialAgentOsChatState(): AgentOsChatState {
  return {
    messages: [],
    isLoading: false,
    status: 'idle',
    errorMessage: '',
    lastSubmittedText: '',
    sessionId: null,
    activeAgent: null,
    streamingAssistantIndex: null,
    lastStreamEventType: null,
    todos: [],
    agents: {},
  }
}

// --- Tool label formatting (mirrors CLI e2b-repl-render.ts) ---

function formatToolLabel(name: string, input?: Record<string, unknown>): string {
  if (!input) return name
  if (name === 'Bash') {
    if (typeof input.description === 'string' && input.description.length > 0) {
      return `Bash(${input.description})`
    }
    if (typeof input.command === 'string') {
      const short =
        input.command.length > 60
          ? `${input.command.slice(0, 57)}...`
          : input.command
      return `Bash(${short})`
    }
    return 'Bash'
  }
  if (name === 'Skill') {
    const skillName = typeof input.skill === 'string' ? input.skill : null
    return skillName ? `skill:${skillName}` : 'Skill'
  }
  if (name === 'Agent' || name === 'Task') {
    const agentName = input.subagent_type ?? input.name ?? input.agent ?? null
    const desc =
      typeof input.description === 'string'
        ? input.description.slice(0, 50)
        : ''
    if (agentName) return `${agentName}${desc ? ` - ${desc}` : ''}`
    if (desc) return `Agent(${desc})`
    return 'Agent'
  }
  const mcpMatch = name.match(/^mcp__(\w+)__(.+)$/)
  if (mcpMatch) {
    const [, server, tool] = mcpMatch
    const params = Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 3)
      .map(([key, value]) => {
        const serialized =
          typeof value === 'string'
            ? value.length > 30
              ? `"${value.slice(0, 30)}..."`
              : `"${value}"`
            : JSON.stringify(value)
        return `${key}: ${serialized}`
      })
      .join(', ')
    return `${server}:${tool}${params ? `(${params})` : ''}`
  }
  const arg =
    input.file_path ??
    input.command ??
    input.pattern ??
    input.url ??
    (typeof input.prompt === 'string' ? input.prompt.slice(0, 60) : null) ??
    ''
  if (arg) {
    const short =
      typeof arg === 'string' && arg.length > 60
        ? `${(arg as string).slice(0, 57)}...`
        : arg
    return `${name}(${short})`
  }
  return name
}

// --- Block-append helpers ---

function ensureAssistantMessage(state: AgentOsChatState): AgentOsChatState {
  if (state.streamingAssistantIndex !== null) return state
  const newMessage: Message = {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    agentOsBlocks: [],
  }
  return {
    ...state,
    messages: [...state.messages, newMessage],
    isLoading: true,
    status: 'busy',
    streamingAssistantIndex: state.messages.length,
  }
}

function pushBlock(
  state: AgentOsChatState,
  block: AgentOsContentBlock,
): AgentOsChatState {
  const s = ensureAssistantMessage(state)
  const idx = s.streamingAssistantIndex!
  return {
    ...s,
    messages: s.messages.map((msg, i) => {
      if (i !== idx) return msg
      return {
        ...msg,
        agentOsBlocks: [...(msg.agentOsBlocks ?? []), block],
      }
    }),
  }
}

function appendToLastTextBlock(
  state: AgentOsChatState,
  text: string,
): AgentOsChatState {
  const s = ensureAssistantMessage(state)
  const idx = s.streamingAssistantIndex!
  return {
    ...s,
    messages: s.messages.map((msg, i) => {
      if (i !== idx) return msg
      const blocks = msg.agentOsBlocks ?? []
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'text') {
        return {
          ...msg,
          agentOsBlocks: [
            ...blocks.slice(0, -1),
            { ...last, text: last.text + text },
          ],
        }
      }
      return {
        ...msg,
        agentOsBlocks: [...blocks, { type: 'text', text }],
      }
    }),
  }
}

function appendToLastThinkingBlock(
  state: AgentOsChatState,
  text: string,
): AgentOsChatState {
  const s = ensureAssistantMessage(state)
  const idx = s.streamingAssistantIndex!
  return {
    ...s,
    messages: s.messages.map((msg, i) => {
      if (i !== idx) return msg
      const blocks = msg.agentOsBlocks ?? []
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'thinking') {
        return {
          ...msg,
          agentOsBlocks: [
            ...blocks.slice(0, -1),
            { ...last, text: last.text + text },
          ],
        }
      }
      return {
        ...msg,
        agentOsBlocks: [
          ...blocks,
          { type: 'thinking', text, isStreaming: true },
        ],
      }
    }),
  }
}

function finalizeThinkingBlocks(state: AgentOsChatState): AgentOsChatState {
  if (state.streamingAssistantIndex === null) return state
  const idx = state.streamingAssistantIndex
  return {
    ...state,
    messages: state.messages.map((msg, i) => {
      if (i !== idx) return msg
      const blocks = msg.agentOsBlocks ?? []
      return {
        ...msg,
        agentOsBlocks: blocks.map((b) =>
          b.type === 'thinking' && b.isStreaming
            ? { ...b, isStreaming: false }
            : b,
        ),
      }
    }),
  }
}

export function appendAgentOsUserMessage(
  state: AgentOsChatState,
  text: string,
): AgentOsChatState {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    ],
    isLoading: true,
    status: 'busy',
    errorMessage: '',
    lastSubmittedText: text,
    streamingAssistantIndex: null,
    lastStreamEventType: null,
  }
}

// --- Event reducer (aligned with CLI e2b-repl-render.ts) ---

export function applyAgentOsEvent(
  state: AgentOsChatState,
  event: AgentOsEvent,
): AgentOsChatState {
  // text — main assistant output
  if (event.type === 'text') {
    const nextText = typeof event.text === 'string' ? event.text : ''
    // Finalize thinking when switching from thinking to text
    const s =
      state.lastStreamEventType === 'thinking'
        ? pushBlock(finalizeThinkingBlocks(state), { type: 'separator' })
        : state
    return {
      ...appendToLastTextBlock(s, nextText),
      lastStreamEventType: 'text',
    }
  }

  // thinking — collapsible block
  if (event.type === 'thinking') {
    const text = typeof event.text === 'string' ? event.text : ''
    if (!text) return state
    return {
      ...appendToLastThinkingBlock(state, text),
      lastStreamEventType: 'thinking',
    }
  }

  // tool_use — structured tool call block
  if (event.type === 'tool_use') {
    const tool = typeof event.tool === 'string' ? event.tool : 'unknown'
    const input =
      event.input && typeof event.input === 'object'
        ? (event.input as Record<string, unknown>)
        : undefined
    const label = formatToolLabel(tool, input)
    const nested = Boolean(event.nested)
    // Finalize thinking if needed
    const s =
      state.lastStreamEventType === 'thinking'
        ? finalizeThinkingBlocks(state)
        : state
    return {
      ...pushBlock(s, { type: 'tool_use', tool, label, input, nested }),
      lastStreamEventType: 'tool_use',
    }
  }

  // tool_log — suppressed
  if (event.type === 'tool_log') {
    return state
  }

  // todo — structured todo list block
  if (event.type === 'todo') {
    const todos = Array.isArray(event.todos) ? event.todos : []
    if (todos.length > 0) {
      return {
        ...pushBlock(state, { type: 'todo', todos }),
        todos,
        lastStreamEventType: 'todo',
      }
    }
    return { ...state, todos }
  }

  // result — cost and duration footer
  if (event.type === 'result') {
    const cost = typeof event.cost === 'number' ? event.cost : 0
    const duration_ms =
      typeof event.duration_ms === 'number' ? event.duration_ms : 0
    const s = finalizeThinkingBlocks(state)
    return {
      ...pushBlock(s, { type: 'result', cost, duration_ms }),
      isLoading: false,
      status: 'idle',
      errorMessage: event.is_error
        ? state.errorMessage || 'AgentOS request failed'
        : '',
      sessionId:
        typeof event.session_id === 'string'
          ? event.session_id
          : state.sessionId,
      streamingAssistantIndex: null,
      lastStreamEventType: null,
    }
  }

  // error
  if (event.type === 'error') {
    const message =
      typeof event.message === 'string' ? event.message : 'Bridge error'
    return {
      ...pushBlock(state, { type: 'error', message }),
      isLoading: false,
      errorMessage: message,
      streamingAssistantIndex: null,
      lastStreamEventType: null,
    }
  }

  // system — compacting context, etc.
  if (event.type === 'system') {
    const subtype = typeof event.subtype === 'string' ? event.subtype : ''
    const detail = event.detail as Record<string, unknown> | undefined
    if (subtype === 'status' && detail?.status === 'compacting') {
      return pushBlock(state, {
        type: 'system',
        text: 'compacting context...',
      })
    }
    if (subtype === 'compact_boundary' && detail) {
      const trigger = detail.trigger ?? 'unknown'
      const preTokens = detail.pre_tokens ?? '?'
      return pushBlock(state, {
        type: 'system',
        text: `compacted (${trigger}, ${preTokens} tokens before)`,
      })
    }
    return state
  }

  // agent_entered
  if (event.type === 'agent_entered') {
    const agent =
      typeof event.agent === 'string' ? event.agent : state.activeAgent ?? ''
    const reason = typeof event.reason === 'string' ? event.reason : undefined
    return {
      ...pushBlock(state, {
        type: 'agent_event',
        agent,
        action: 'entered',
        reason,
      }),
      activeAgent: agent,
      sessionId:
        typeof event.session_id === 'string'
          ? event.session_id
          : state.sessionId,
      lastStreamEventType: 'agent',
    }
  }

  // agent_exited
  if (event.type === 'agent_exited') {
    const agent = typeof event.agent === 'string' ? event.agent : ''
    const reason = typeof event.reason === 'string' ? event.reason : undefined
    return {
      ...pushBlock(state, {
        type: 'agent_event',
        agent,
        action: 'exited',
        reason,
      }),
      activeAgent: null,
      lastStreamEventType: 'agent',
    }
  }

  // history — restore previous conversation
  if (event.type === 'history') {
    const restoredMessages = Array.isArray(event.messages)
      ? event.messages
          .filter(
            (
              message,
            ): message is {
              role: 'user' | 'assistant'
              content: string
            } =>
              Boolean(message) &&
              typeof message === 'object' &&
              'role' in message &&
              'content' in message &&
              (message.role === 'user' || message.role === 'assistant') &&
              typeof message.content === 'string',
          )
          .map((message) => ({
            role: message.role,
            content: [{ type: 'text' as const, text: message.content }],
            // For restored history, put content in blocks too
            ...(message.role === 'assistant'
              ? {
                  agentOsBlocks: [
                    { type: 'text' as const, text: message.content },
                  ],
                }
              : {}),
          }))
      : []

    return {
      ...state,
      isLoading: false,
      status: 'idle',
      messages: restoredMessages,
      streamingAssistantIndex: null,
      lastStreamEventType: null,
    }
  }

  // skills — store agent map for picker, not rendered in chat
  if (event.type === 'skills') {
    const agents =
      event.skills && typeof event.skills === 'object' && !Array.isArray(event.skills)
        ? (event.skills as Record<string, AgentDetail>)
        : {}
    return { ...state, agents }
  }

  // status
  if (event.type === 'status') {
    const nextStatus =
      event.state === 'idle' ||
      event.state === 'busy' ||
      event.state === 'disconnected'
        ? event.state
        : state.status

    return {
      ...state,
      status: nextStatus,
      sessionId:
        typeof event.session_id === 'string'
          ? event.session_id
          : state.sessionId,
      isLoading: nextStatus === 'busy',
      streamingAssistantIndex:
        nextStatus === 'busy' ? state.streamingAssistantIndex : null,
      errorMessage:
        nextStatus === 'disconnected'
          ? 'AgentOS bridge disconnected'
          : state.errorMessage,
    }
  }

  return state
}
