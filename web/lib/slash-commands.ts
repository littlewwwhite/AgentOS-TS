import { AgentOsCommand } from './agentos-protocol'

type ChatAgentCommand = Extract<AgentOsCommand, { cmd: 'chat' }>

export const FIXED_MODEL = 'claude-sonnet-4-6'

export const HELP_NOTICE =
  'Commands: /enter <agent>, /exit, /agents, /skills, /status, /model, /resume <session_id>, /stop, /clear, /help'

export const SLASH_COMMANDS = [
  { cmd: '/enter ', label: '/enter <agent>', desc: 'Switch to a specific agent' },
  { cmd: '/exit', label: '/exit', desc: 'Return to the main agent' },
  { cmd: '/agents', label: '/agents', desc: 'List available agents' },
  { cmd: '/skills', label: '/skills', desc: 'List available skills' },
  { cmd: '/status', label: '/status', desc: 'Show bridge & agent status' },
  { cmd: '/model', label: '/model', desc: 'Show the fixed agent model' },
  { cmd: '/resume ', label: '/resume <session_id>', desc: 'Resume a previous session' },
  { cmd: '/stop', label: '/stop', desc: 'Interrupt the current run' },
  { cmd: '/clear', label: '/clear', desc: 'Clear the current transcript' },
  { cmd: '/help', label: '/help', desc: 'Show help' },
] as const

export type PromptInterpretation =
  | {
      kind: 'command'
      selectedAgent: string
      command: ChatAgentCommand
    }
  | {
      kind: 'local'
      selectedAgent: string
      notice: string
      command?: AgentOsCommand
    }
  | {
      kind: 'error'
      selectedAgent: string
      notice: string
    }

function toChatCommand(message: string, selectedAgent: string): ChatAgentCommand {
  if (selectedAgent === 'main') {
    return { cmd: 'chat', message }
  }

  return { cmd: 'chat', message, target: selectedAgent }
}

export function interpretPrompt(
  input: string,
  {
    selectedAgent,
    availableAgents,
  }: {
    selectedAgent: string
    availableAgents: string[]
  },
): PromptInterpretation {
  const trimmed = input.trim()
  const activeAgent = selectedAgent || 'main'

  if (!trimmed.startsWith('/')) {
    return {
      kind: 'command',
      selectedAgent: activeAgent,
      command: toChatCommand(trimmed, activeAgent),
    }
  }

  const [rawCommand, ...rest] = trimmed.split(/\s+/)
  const command = rawCommand.toLowerCase()
  const arg = rest.join(' ').trim()

  switch (command) {
    case '/enter':
      if (!arg) {
        return {
          kind: 'error',
          selectedAgent: activeAgent,
          notice: 'Missing agent name. Usage: /enter <agent>',
        }
      }
      if (!availableAgents.includes(arg)) {
        return {
          kind: 'error',
          selectedAgent: activeAgent,
          notice: `Unknown agent "${arg}". Available: ${availableAgents.join(', ')}`,
        }
      }
      return {
        kind: 'local',
        selectedAgent: arg,
        command: { cmd: 'enter_agent', agent: arg },
        notice: `Switched to ${arg} · model ${FIXED_MODEL}`,
      }
    case '/exit':
      return {
        kind: 'local',
        selectedAgent: 'main',
        command: { cmd: 'exit_agent' },
        notice: `Switched to main · model ${FIXED_MODEL}`,
      }
    case '/agents':
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        notice: `Available agents: ${availableAgents.join(', ')}`,
      }
    case '/skills':
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        command: { cmd: 'list_skills' },
        notice: `Requested skills for ${activeAgent}`,
      }
    case '/status':
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        command: { cmd: 'status' },
        notice: `Requested status for ${activeAgent} · model ${FIXED_MODEL}`,
      }
    case '/model':
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        notice: `Model is fixed to ${FIXED_MODEL}`,
      }
    case '/resume':
      if (!arg) {
        return {
          kind: 'error',
          selectedAgent: activeAgent,
          notice: 'Missing session id. Usage: /resume <session_id>',
        }
      }
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        command: { cmd: 'resume', session_id: arg },
        notice: `Requested resume for ${arg} · model ${FIXED_MODEL}`,
      }
    case '/stop':
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        command: { cmd: 'interrupt' },
        notice: `Stopped ${activeAgent}`,
      }
    case '/clear':
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        notice: 'Cleared chat history',
      }
    case '/help':
      return {
        kind: 'local',
        selectedAgent: activeAgent,
        notice: HELP_NOTICE,
      }
    default:
      return {
        kind: 'command',
        selectedAgent: activeAgent,
        command: toChatCommand(trimmed, activeAgent),
      }
  }
}

export function shouldAppendLocalNotice(
  interpretation: PromptInterpretation,
): boolean {
  if (interpretation.kind === 'error') {
    return true
  }

  if (interpretation.kind === 'local') {
    return interpretation.command === undefined
  }

  return false
}
