export type AgentOsConnectionState =
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'disconnected'
  | 'error'

function getDefaultAgentOsServerBaseUrl(): string {
  const port = process.env.NEXT_PUBLIC_AGENTOS_SERVER_PORT ?? '3101'

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${window.location.hostname}:${port}`
  }

  return `http://localhost:${port}`
}

export function getInitialAgentOsServerBaseUrl(): string {
  const explicitServerUrl = process.env.NEXT_PUBLIC_AGENTOS_SERVER_URL
  if (explicitServerUrl) {
    return explicitServerUrl.replace(/\/$/, '')
  }

  return `http://localhost:${process.env.NEXT_PUBLIC_AGENTOS_SERVER_PORT ?? '3101'}`
}

export function getAgentOsServerBaseUrl(): string {
  const explicitServerUrl = process.env.NEXT_PUBLIC_AGENTOS_SERVER_URL
  if (explicitServerUrl) {
    return explicitServerUrl.replace(/\/$/, '')
  }

  return getDefaultAgentOsServerBaseUrl()
}

export function getAgentOsProjectId(): string {
  return process.env.NEXT_PUBLIC_AGENTOS_DEFAULT_PROJECT_ID ?? 'demo-project'
}

export function getAgentOsWebSocketUrl(projectId: string): string {
  const url = new URL(getAgentOsServerBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/ws/${encodeURIComponent(projectId)}`
  return url.toString()
}

// --- Guest token cache ---

const TOKEN_KEY = 'agentos_token'
let cachedToken: string | null = null
let tokenPromise: Promise<string | null> | null = null

export async function getAgentOsToken(): Promise<string | null> {
  if (cachedToken) return cachedToken

  // Restore from localStorage on first call
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (stored) {
      cachedToken = stored
      return stored
    }
  }

  if (tokenPromise) return tokenPromise

  // Build request — send existing token (if any) so server can reuse the user
  const headers: Record<string, string> = {}
  if (cachedToken) {
    headers['Authorization'] = `Bearer ${cachedToken}`
  }

  tokenPromise = fetch(`${getAgentOsServerBaseUrl()}/api/auth/session`, {
    method: 'POST',
    headers,
  })
    .then(async (res) => {
      if (!res.ok) return null
      const data = (await res.json()) as { token?: string }
      cachedToken = data.token ?? null
      if (cachedToken && typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_KEY, cachedToken)
      }
      return cachedToken
    })
    .catch(() => null)
    .finally(() => {
      tokenPromise = null
    })

  return tokenPromise
}

export function setAgentOsToken(token: string): void {
  cachedToken = token
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token)
  }
}

export async function agentOsFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAgentOsToken()
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(`${getAgentOsServerBaseUrl()}${path}`, { ...init, headers })
}

// --- Session list ---

export interface ProjectSession {
  projectId: string
  sandboxId: string | null
  createdAt: number
  updatedAt: number
  ownerId?: string
  agentSessionIds: Record<string, string>
  activeAgent: string | null
}

export async function fetchAgentOsSessions(): Promise<ProjectSession[]> {
  try {
    const res = await agentOsFetch('/api/projects')
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []
    return data as ProjectSession[]
  } catch {
    return []
  }
}
