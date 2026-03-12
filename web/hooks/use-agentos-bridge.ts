'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  startAgentOsBridgeLifecycle,
  type AgentOsBridgeState,
} from '@/lib/agentos-bridge-lifecycle'
import {
  getAgentOsServerBaseUrl,
  getAgentOsWebSocketUrl,
  getInitialAgentOsServerBaseUrl,
} from '@/lib/agentos'
import { AgentOsCommand, AgentOsEvent } from '@/lib/agentos-protocol'

export type { AgentOsBridgeState } from '@/lib/agentos-bridge-lifecycle'

export function useAgentOsBridge({
  projectId,
  onEvent,
}: {
  projectId: string
  onEvent?: (event: AgentOsEvent) => void
}) {
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const onEventRef = useRef(onEvent)

  const [state, setState] = useState<AgentOsBridgeState>('connecting')
  const [statusMessage, setStatusMessage] = useState('Waiting for sandbox bridge')
  const [skillsCount, setSkillsCount] = useState(0)
  const [serverUrl, setServerUrl] = useState(getInitialAgentOsServerBaseUrl)

  onEventRef.current = onEvent

  const sendCommand = useCallback(async (cmd: AgentOsCommand) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('AgentOS bridge is not connected')
    }
    socket.send(JSON.stringify(cmd))
  }, [])

  useEffect(() => {
    return startAgentOsBridgeLifecycle({
      projectId,
      onEventRef,
      socketRef,
      reconnectTimerRef,
      setState,
      setStatusMessage,
      setSkillsCount,
      setServerUrl,
      getServerBaseUrl: getAgentOsServerBaseUrl,
      getWebSocketUrl: getAgentOsWebSocketUrl,
    })
  }, [projectId])

  return {
    state,
    statusMessage,
    skillsCount,
    serverUrl,
    sendCommand,
  }
}
