import type { AgentOsEvent } from './agentos-protocol'
import { getAgentOsToken, setAgentOsToken } from './agentos'

export type AgentOsBridgeState =
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'disconnected'
  | 'error'

type Setter<T> = (value: T | ((current: T) => T)) => void

export function startAgentOsBridgeLifecycle({
  projectId,
  onEventRef,
  socketRef,
  reconnectTimerRef,
  setState,
  setStatusMessage,
  setSkillsCount,
  setServerUrl,
  getServerBaseUrl,
  getWebSocketUrl,
}: {
  projectId: string
  onEventRef: { current: ((event: AgentOsEvent) => void) | undefined }
  socketRef: { current: WebSocket | null }
  reconnectTimerRef: { current: number | null }
  setState: Setter<AgentOsBridgeState>
  setStatusMessage: Setter<string>
  setSkillsCount: Setter<number>
  setServerUrl: Setter<string>
  getServerBaseUrl: () => string
  getWebSocketUrl: (projectId: string) => string
}) {
  let disposed = false
  let reconnectAttempts = 0

  const connect = () => {
    if (disposed) {
      return
    }

    const nextServerUrl = getServerBaseUrl()
    setServerUrl(nextServerUrl)
    setState('connecting')
    setStatusMessage('Connecting to sandbox bridge')

    // Fetch guest token before opening WebSocket (uses shared cache)
    getAgentOsToken()
      .then((token) => {
        if (disposed) return
        if (token) setAgentOsToken(token)

        let wsUrl = getWebSocketUrl(projectId)
        if (token) {
          const sep = wsUrl.includes('?') ? '&' : '?'
          wsUrl = `${wsUrl}${sep}token=${encodeURIComponent(token)}`
        }

        openSocket(wsUrl)
      })
      .catch(() => {
        if (disposed) return
        openSocket(getWebSocketUrl(projectId))
      })
  }

  const openSocket = (wsUrl: string) => {
    if (disposed) return

    const socket = new WebSocket(wsUrl)
    socketRef.current = socket

    socket.addEventListener('open', () => {
      reconnectAttempts = 0
      setState('connected')
      setStatusMessage('Socket opened, requesting status')
      socket.send(JSON.stringify({ cmd: 'status' }))
      socket.send(JSON.stringify({ cmd: 'list_skills' }))
    })

    socket.addEventListener('message', (raw) => {
      try {
        const event = JSON.parse(raw.data as string) as AgentOsEvent
        onEventRef.current?.(event)

        if (event.type === 'ready') {
          setState('ready')
          setSkillsCount(Array.isArray(event.skills) ? event.skills.length : 0)
          setStatusMessage('Bridge ready')
          return
        }

        if (event.type === 'skills') {
          setSkillsCount(
            event.skills &&
              typeof event.skills === 'object' &&
              !Array.isArray(event.skills)
              ? Object.keys(event.skills).length
              : 0,
          )
          return
        }

        if (event.type === 'status') {
          if (event.state === 'disconnected') {
            setState('disconnected')
            setStatusMessage('Sandbox disconnected')
          } else {
            setStatusMessage(`Sandbox ${event.state}`)
          }
          return
        }

        if (event.type === 'error') {
          setState('error')
          setStatusMessage(
            typeof event.message === 'string' ? event.message : 'Bridge error',
          )
        }
      } catch {
        setState('error')
        setStatusMessage('Invalid bridge payload')
      }
    })

    socket.addEventListener('error', () => {
      setState('error')
      setStatusMessage('Unable to reach AgentOS bridge')
    })

    socket.addEventListener('close', () => {
      if (disposed) {
        return
      }

      setState((current) => (current === 'error' ? current : 'disconnected'))
      reconnectAttempts += 1
      const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 5000)
      reconnectTimerRef.current = window.setTimeout(connect, delay)
    })
  }

  const initialConnectTimer = window.setTimeout(connect, 0)

  return () => {
    disposed = true
    window.clearTimeout(initialConnectTimer)
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
    }
    socketRef.current?.close()
    socketRef.current = null
  }
}
