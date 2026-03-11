export type AgentOsCommand =
  | { cmd: 'chat'; message: string; target?: string; request_id?: string }
  | { cmd: 'interrupt' }
  | { cmd: 'status' }
  | { cmd: 'list_skills' }
  | { cmd: 'enter_agent'; agent: string }
  | { cmd: 'exit_agent' }
  | { cmd: 'resume'; session_id: string }
  | { cmd: 'set_model'; model: string }

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  id: string
  content: string
  status: TodoStatus
}

export type AgentDetail = {
  description: string
  skills?: string[]
  mcpServers?: string[]
}

export type AgentOsEvent =
  | { type: 'ready'; skills: string[] }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; tool: string; id: string; input?: Record<string, unknown>; nested?: boolean }
  | { type: 'tool_log'; tool: string; phase: 'pre' | 'post'; detail?: Record<string, unknown> }
  | { type: 'system'; subtype: string; detail?: Record<string, unknown> }
  | { type: 'todo'; todos: TodoItem[] }
  | {
      type: 'result'
      cost: number
      duration_ms: number
      session_id: string
      is_error: boolean
    }
  | { type: 'error'; message: string }
  | { type: 'status'; state: 'idle' | 'busy' | 'disconnected'; session_id?: string }
  | { type: 'skills'; skills: Record<string, AgentDetail> }
  | { type: 'agent_entered'; agent: string; session_id?: string; reason?: string }
  | { type: 'agent_exited'; agent: string; reason?: string }
  | {
      type: 'history'
      messages: Array<{
        role: 'user' | 'assistant'
        content: string
        timestamp?: number
      }>
    }
  | { type: string; [key: string]: unknown }
