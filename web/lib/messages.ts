import { FragmentSchema } from './schema'
import { ExecutionResult } from './types'
import { TodoItem } from './agentos-protocol'
import { DeepPartial } from 'ai'

export type MessageText = {
  type: 'text'
  text: string
}

export type MessageCode = {
  type: 'code'
  text: string
}

export type MessageImage = {
  type: 'image'
  image: string
}

// --- Structured content blocks for AgentOS assistant messages ---

export type AgentOsContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; isStreaming: boolean }
  | { type: 'tool_use'; tool: string; label: string; input?: Record<string, unknown>; nested?: boolean }
  | { type: 'todo'; todos: TodoItem[] }
  | { type: 'result'; cost: number; duration_ms: number }
  | { type: 'error'; message: string }
  | { type: 'agent_event'; agent: string; action: 'entered' | 'exited'; reason?: string }
  | { type: 'system'; text: string }
  | { type: 'separator' }

export type Message = {
  role: 'assistant' | 'user'
  content: Array<MessageText | MessageCode | MessageImage>
  agentOsBlocks?: AgentOsContentBlock[]
  object?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
}

export function toAISDKMessages(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((content) => {
      if (content.type === 'code') {
        return {
          type: 'text',
          text: content.text,
        }
      }

      return content
    }),
  }))
}

export async function toMessageImage(files: File[]) {
  if (files.length === 0) {
    return []
  }

  return Promise.all(
    files.map(async (file) => {
      const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
      return `data:${file.type};base64,${base64}`
    }),
  )
}
