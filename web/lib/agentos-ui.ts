import type { AgentOsBridgeState } from '@/hooks/use-agentos-bridge'

export function getEffectiveAgentOsBridgeState(
  bridgeState: AgentOsBridgeState,
  skillsCount: number,
): AgentOsBridgeState {
  if (bridgeState === 'connected' && skillsCount > 0) {
    return 'ready'
  }

  return bridgeState
}

export function shouldEnableAgentOsWorkspacePane(
  useAgentOsChatMode: boolean,
  bridgeState: AgentOsBridgeState,
  sessionId: string | null,
): boolean {
  if (!useAgentOsChatMode) {
    return false
  }

  if (bridgeState === 'ready') {
    return true
  }

  if (bridgeState === 'error' || bridgeState === 'disconnected') {
    return false
  }

  return sessionId !== null
}

export function getAgentOsSidePaneMode({
  hasPreview,
  workspaceOpen,
  workspaceAvailable,
}: {
  hasPreview: boolean
  workspaceOpen: boolean
  workspaceAvailable: boolean
}): 'preview' | 'workspace' | null {
  if (workspaceOpen && workspaceAvailable) {
    return 'workspace'
  }

  if (hasPreview) {
    return 'preview'
  }

  return null
}
