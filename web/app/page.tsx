'use client'

import { ViewType } from '@/components/auth'
import { AuthDialog } from '@/components/auth-dialog'
import { AgentOsChatMessages } from '@/components/agentos-chat-messages'
import { Chat } from '@/components/chat'
import { ChatInput } from '@/components/chat-input'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { AgentOsWorkspace } from '@/components/agentos-workspace'
import { AgentOsStatus } from '@/components/agentos-status'
import { AgentOsInfoPanel } from '@/components/agentos-info-panel'
import { NavBar } from '@/components/navbar'
import { Preview } from '@/components/preview'
import { getAgentOsProjectId, fetchAgentOsSessions, ProjectSession } from '@/lib/agentos'
import {
  applyAgentOsEvent,
  appendAgentOsUserMessage,
  createInitialAgentOsChatState,
} from '@/lib/agentos-chat'
import { uploadFiles } from '@/lib/agentos-file-upload'
import { AgentOsCommand } from '@/lib/agentos-protocol'
import {
  getAgentOsSidePaneMode,
  shouldEnableAgentOsWorkspacePane,
} from '@/lib/agentos-ui'
import { useAuth } from '@/lib/auth'
import { Message, toAISDKMessages, toMessageImage } from '@/lib/messages'
import { LLMModelConfig } from '@/lib/models'
import modelsList from '@/lib/models.json'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import { supabase } from '@/lib/supabase'
import templates from '@/lib/templates'
import { ExecutionResult } from '@/lib/types'
import { useAgentOsBridge } from '@/hooks/use-agentos-bridge'
import { cn } from '@/lib/utils'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject } from 'ai/react'
import { usePostHog } from 'posthog-js/react'
import { SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'

export default function Home() {
  const agentOsProjectId = useMemo(() => getAgentOsProjectId(), [])
  const useAgentOsChatMode = process.env.NEXT_PUBLIC_USE_AGENTOS_CHAT !== 'false'
  const [chatInput, setChatInput] = useLocalStorage('chat', '')
  const [files, setFiles] = useState<File[]>([])
  const [agentOsChat, setAgentOsChat] = useState(createInitialAgentOsChatState)
  const [agentOsModel, setAgentOsModel] = useLocalStorage('agentOsModel', 'claude-sonnet-4-6')
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    'auto',
  )
  const [languageModel, setLanguageModel] = useLocalStorage<LLMModelConfig>(
    'languageModel',
    {
      model: 'claude-sonnet-4-20250514',
    },
  )

  const posthog = usePostHog()

  const [result, setResult] = useState<ExecutionResult>()
  const [messages, setMessages] = useState<Message[]>([])
  const [fragment, setFragment] = useState<DeepPartial<FragmentSchema>>()
  const [currentTab, setCurrentTab] = useState<'code' | 'fragment'>('code')
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [sessions, setSessions] = useState<ProjectSession[]>([])
  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const [authView, setAuthView] = useState<ViewType>('sign_in')
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const { session, userTeam } = useAuth(setAuthDialog, setAuthView)
  const [useMorphApply, setUseMorphApply] = useLocalStorage(
    'useMorphApply',
    process.env.NEXT_PUBLIC_USE_MORPH_APPLY === 'true',
  )
  const agentOsBridge = useAgentOsBridge({
    projectId: agentOsProjectId,
    onEvent: (event) => {
      setAgentOsChat((current) => applyAgentOsEvent(current, event))
    },
  })

  const filteredModels = modelsList.models.filter((model) => {
    if (process.env.NEXT_PUBLIC_HIDE_LOCAL_MODELS) {
      return model.providerId !== 'ollama'
    }
    return true
  })

  const defaultModel = filteredModels.find(
    (model) => model.id === 'claude-sonnet-4-20250514',
  ) || filteredModels[0]

  const currentModel = filteredModels.find(
    (model) => model.id === languageModel.model,
  ) || defaultModel

  const setMessage = useCallback((message: Partial<Message>, index?: number) => {
    setMessages((previousMessages) => {
      const targetIndex = index ?? previousMessages.length - 1
      const targetMessage = previousMessages[targetIndex]

      if (!targetMessage) {
        return previousMessages
      }

      const updatedMessages = [...previousMessages]
      updatedMessages[targetIndex] = {
        ...targetMessage,
        ...message,
      }

      return updatedMessages
    })
  }, [])

  const addMessage = useCallback((message: Message) => {
    const nextMessages = [...messages, message]
    setMessages(nextMessages)
    return nextMessages
  }, [messages])

  // Update localStorage if stored model no longer exists
  useEffect(() => {
    if (languageModel.model && !filteredModels.find((m) => m.id === languageModel.model)) {
      setLanguageModel({ ...languageModel, model: defaultModel.id })
    }
  }, [defaultModel.id, filteredModels, languageModel, setLanguageModel])

  // Fetch session history on mount
  useEffect(() => {
    if (!useAgentOsChatMode) return
    fetchAgentOsSessions().then(setSessions)
  }, [useAgentOsChatMode])
  const currentTemplate =
    selectedTemplate === 'auto'
      ? templates
      : { [selectedTemplate]: templates[selectedTemplate] }
  const lastMessage = messages[messages.length - 1]

  // Determine which API to use based on morph toggle and existing fragment
  const shouldUseMorph =
    useMorphApply && fragment && fragment.code && fragment.file_path
  const apiEndpoint = shouldUseMorph ? '/api/morph-chat' : '/api/chat'

  const { object, submit, isLoading, stop, error } = useObject({
    api: apiEndpoint,
    schema,
    onError: (error) => {
      console.error('Error submitting request:', error)
      if (error.message.includes('limit')) {
        setIsRateLimited(true)
      }

      setErrorMessage(error.message)
    },
    onFinish: async ({ object: fragment, error }) => {
      if (!error) {
        // send it to /api/sandbox
        console.log('fragment', fragment)
        setIsPreviewLoading(true)
        posthog.capture('fragment_generated', {
          template: fragment?.template,
        })

        const response = await fetch('/api/sandbox', {
          method: 'POST',
          body: JSON.stringify({
            fragment,
            userID: session?.user?.id,
            teamID: userTeam?.id,
            accessToken: session?.access_token,
          }),
        })

        const result = await response.json()
        console.log('result', result)
        posthog.capture('sandbox_created', { url: result.url })

        setResult(result)
        setCurrentPreview({ fragment, result })
        setMessage({ result })
        setCurrentTab('fragment')
        setIsPreviewLoading(false)
      }
    },
  })

  const renderedMessages = useAgentOsChatMode ? agentOsChat.messages : messages
  const renderedIsLoading = useAgentOsChatMode ? agentOsChat.isLoading : isLoading
  const renderedErrorMessage = useAgentOsChatMode ? agentOsChat.errorMessage : errorMessage
  const renderedIsErrored = useAgentOsChatMode
    ? Boolean(agentOsChat.errorMessage)
    : error !== undefined
  const workspaceAvailable = shouldEnableAgentOsWorkspacePane(
    useAgentOsChatMode,
    agentOsBridge.state,
    agentOsChat.sessionId,
  )
  const sidePaneMode = getAgentOsSidePaneMode({
    hasPreview: Boolean(fragment),
    workspaceOpen,
    workspaceAvailable,
  })

  useEffect(() => {
    if (object) {
      setFragment(object)
      const content: Message['content'] = [
        { type: 'text', text: object.commentary || '' },
        { type: 'code', text: object.code || '' },
      ]

      if (!lastMessage || lastMessage.role !== 'assistant') {
        addMessage({
          role: 'assistant',
          content,
          object,
        })
      }

      if (lastMessage && lastMessage.role === 'assistant') {
        setMessage({
          content,
          object,
        })
      }
    }
  }, [addMessage, lastMessage, object, setMessage])

  useEffect(() => {
    if (error) stop()
  }, [error, stop])

  useEffect(() => {
    if (!workspaceAvailable && workspaceOpen) {
      setWorkspaceOpen(false)
    }
  }, [workspaceAvailable, workspaceOpen])

  async function handleSubmitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (useAgentOsChatMode) {
      const nextText = chatInput.trim()
      if (!nextText) {
        return
      }

      // Parse slash commands into AgentOS protocol commands
      const slashCommand = parseSlashCommand(nextText)

      if (slashCommand === 'help') {
        // Local-only: inject a help message without hitting the bridge
        setAgentOsChat((current) => ({
          ...appendAgentOsUserMessage(current, nextText),
          messages: [
            ...current.messages,
            { role: 'user', content: [{ type: 'text', text: nextText }] },
            {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: [
                    '**Available commands:**',
                    '`/enter <agent>` — switch to a specific agent',
                    '`/exit` — return to the default agent',
                    '`/status` — show bridge & agent status',
                    '`/skills` — list available skills',
                    '`/resume <session_id>` — resume a previous session',
                    '`/help` — show this help',
                    '',
                    'Any other input is sent as a chat message.',
                  ].join('\n'),
                },
              ],
            },
          ],
          isLoading: false,
          status: current.status === 'disconnected' ? 'disconnected' : 'idle',
        }))
        setChatInput('')
        return
      }

      setAgentOsChat((current) => appendAgentOsUserMessage(current, nextText))
      setChatInput('')
      setFiles([])
      setCurrentTab('code')
      setWorkspaceOpen(false)

      try {
        // Upload attached files to sandbox before sending chat command
        if (files.length > 0) {
          const uploadedPaths = await uploadFiles({
            projectId: agentOsProjectId,
            selectedPath: null,
            files,
          })
          if (uploadedPaths.length > 0) {
            const pathList = uploadedPaths.map((p) => `\`${p}\``).join(', ')
            const command: AgentOsCommand = slashCommand ?? {
              cmd: 'chat',
              message: `${nextText}\n\n[Uploaded files: ${pathList}]`,
            }
            await agentOsBridge.sendCommand(command)
            return
          }
        }

        const command: AgentOsCommand = slashCommand ?? { cmd: 'chat', message: nextText }
        await agentOsBridge.sendCommand(command)
      } catch (submitError) {
        setAgentOsChat((current) =>
          applyAgentOsEvent(current, {
            type: 'error',
            message:
              submitError instanceof Error
                ? submitError.message
                : String(submitError),
          }),
        )
      }
      return
    }

    if (!session) {
      return setAuthDialog(true)
    }

    if (isLoading) {
      stop()
    }

    const content: Message['content'] = [{ type: 'text', text: chatInput }]
    const images = await toMessageImage(files)

    if (images.length > 0) {
      images.forEach((image) => {
        content.push({ type: 'image', image })
      })
    }

    const updatedMessages = addMessage({
      role: 'user',
      content,
    })

    submit({
      userID: session?.user?.id,
      teamID: userTeam?.id,
      messages: toAISDKMessages(updatedMessages),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
      ...(shouldUseMorph && fragment ? { currentFragment: fragment } : {}),
    })

    setChatInput('')
    setFiles([])
    setCurrentTab('code')
    setWorkspaceOpen(false)

    posthog.capture('chat_submit', {
      template: selectedTemplate,
      model: languageModel.model,
    })
  }

  function retry() {
    if (useAgentOsChatMode) {
      const nextText = agentOsChat.lastSubmittedText.trim()
      if (!nextText) {
        return
      }

      setAgentOsChat((current) => appendAgentOsUserMessage(current, nextText))
      setWorkspaceOpen(false)
      void agentOsBridge.sendCommand({ cmd: 'chat', message: nextText }).catch((retryError) => {
        setAgentOsChat((current) =>
          applyAgentOsEvent(current, {
            type: 'error',
            message: retryError instanceof Error ? retryError.message : String(retryError),
          }),
        )
      })
      return
    }

    submit({
      userID: session?.user?.id,
      teamID: userTeam?.id,
      messages: toAISDKMessages(messages),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
      ...(shouldUseMorph && fragment ? { currentFragment: fragment } : {}),
    })
  }

  function handleSaveInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setChatInput(e.target.value)
  }

  const handleFileChange = useCallback((change: SetStateAction<File[]>) => {
    setFiles(change)
  }, [])

  function logout() {
    supabase
      ? supabase.auth.signOut()
      : console.warn('Supabase is not initialized')
  }

  function handleLanguageModelChange(e: LLMModelConfig) {
    setLanguageModel({ ...languageModel, ...e })
  }

  function handleSocialClick(target: 'github' | 'x' | 'discord') {
    if (target === 'github') {
      window.open('https://github.com/e2b-dev/fragments', '_blank')
    } else if (target === 'x') {
      window.open('https://x.com/e2b', '_blank')
    } else if (target === 'discord') {
      window.open('https://discord.gg/e2b', '_blank')
    }

    posthog.capture(`${target}_click`)
  }

  function handleClearChat() {
    if (useAgentOsChatMode) {
      setAgentOsChat(createInitialAgentOsChatState())
    } else {
      stop()
    }
    setChatInput('')
    setFiles([])
    setMessages([])
    setFragment(undefined)
    setResult(undefined)
    setCurrentTab('code')
    setWorkspaceOpen(false)
    setIsPreviewLoading(false)
  }

  function setCurrentPreview(preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) {
    setFragment(preview.fragment)
    setResult(preview.result)
    setWorkspaceOpen(false)
  }

  function handleUndo() {
    if (useAgentOsChatMode) {
      setAgentOsChat((current) => ({
        ...current,
        messages: current.messages.slice(0, -2),
        isLoading: false,
        errorMessage: '',
        streamingAssistantIndex: null,
        lastStreamEventType: null,
      }))
    } else {
      setMessages((previousMessages) => [...previousMessages.slice(0, -2)])
    }
    setCurrentPreview({ fragment: undefined, result: undefined })
  }

  return (
    <main className="flex h-screen overflow-hidden">
      {supabase && (
        <AuthDialog
          open={isAuthDialogOpen}
          setOpen={setAuthDialog}
          view={authView}
          supabase={supabase}
        />
      )}
      <div className={cn(
        'grid w-full h-full overflow-hidden',
        infoOpen && sidePaneMode
          ? 'grid-cols-[260px_1fr_1fr]'
          : infoOpen
            ? 'grid-cols-[260px_1fr]'
            : sidePaneMode
              ? 'md:grid-cols-2'
              : '',
      )}>
        {infoOpen && (
          <AgentOsInfoPanel
            sessions={sessions}
            agents={agentOsChat.agents}
            currentProjectId={agentOsProjectId}
            onResumeSession={(sessionId) => {
              void agentOsBridge.sendCommand({ cmd: 'resume', session_id: sessionId })
            }}
            onSwitchAgent={(agent) => {
              void agentOsBridge.sendCommand({ cmd: 'enter_agent', agent })
            }}
          />
        )}
        <div
          className={cn(
            'flex flex-col h-full overflow-hidden max-w-[800px] mx-auto px-4 w-full',
            !sidePaneMode && !infoOpen && 'col-span-2',
          )}
        >
          <NavBar
            session={session}
            showLogin={() => setAuthDialog(true)}
            signOut={logout}
            onSocialClick={handleSocialClick}
            onClear={handleClearChat}
            canClear={renderedMessages.length > 0}
            canUndo={renderedMessages.length > 1 && !renderedIsLoading}
            onUndo={handleUndo}
          />
          <AgentOsStatus
            state={agentOsBridge.state}
            sandboxStatus={agentOsChat.status}
            skillsCount={agentOsBridge.skillsCount}
            message={agentOsBridge.statusMessage}
            workspaceAvailable={workspaceAvailable}
            workspaceOpen={sidePaneMode === 'workspace'}
            hasPreview={Boolean(fragment)}
            infoOpen={infoOpen}
            onToggleInfo={() => setInfoOpen((v) => !v)}
            onToggleWorkspace={() => {
              if (!workspaceAvailable) {
                return
              }
              setWorkspaceOpen((current) => !current)
            }}
            onShowPreview={() => setWorkspaceOpen(false)}
          />
          <div id="chat-scroll-area" className="flex-1 min-h-0 overflow-y-auto">
            {useAgentOsChatMode ? (
              <AgentOsChatMessages
                messages={renderedMessages}
                isLoading={renderedIsLoading}
              />
            ) : (
              <Chat
                messages={renderedMessages}
                isLoading={renderedIsLoading}
                setCurrentPreview={setCurrentPreview}
              />
            )}
          </div>
          <div className="relative mt-auto shrink-0">
            {useAgentOsChatMode && (
              <div className="absolute bottom-full left-0 right-0 z-50 px-4 pb-1">
                <SlashSuggestions
                  input={chatInput}
                  agents={agentOsChat.agents}
                  onSelect={(text) => {
                    setChatInput(text)
                    document.getElementById('chat-input')?.focus()
                  }}
                />
              </div>
            )}
          <ChatInput
            retry={retry}
            isErrored={renderedIsErrored}
            errorMessage={renderedErrorMessage}
            isLoading={renderedIsLoading}
            isRateLimited={useAgentOsChatMode ? false : isRateLimited}
            stop={() => {
              if (useAgentOsChatMode) {
                void agentOsBridge.sendCommand({ cmd: 'interrupt' }).catch((stopError) => {
                  setAgentOsChat((current) =>
                    applyAgentOsEvent(current, {
                      type: 'error',
                      message: stopError instanceof Error ? stopError.message : String(stopError),
                    }),
                  )
                })
                return
              }
              stop()
            }}
            input={chatInput}
            handleInputChange={handleSaveInputChange}
            handleSubmit={handleSubmitAuth}
            isMultiModal={useAgentOsChatMode ? true : currentModel?.multiModal || false}
            files={files}
            handleFileChange={handleFileChange}
          >
            {useAgentOsChatMode ? (
              <AgentOsChatBar
                activeAgent={agentOsChat.activeAgent}
                agents={agentOsChat.agents}
                model={agentOsModel}
                onSwitchAgent={(agent) => {
                  if (agent === 'main') {
                    void agentOsBridge.sendCommand({ cmd: 'exit_agent' })
                  } else {
                    void agentOsBridge.sendCommand({ cmd: 'enter_agent', agent })
                  }
                }}
                onSwitchModel={(model) => {
                  setAgentOsModel(model)
                  void agentOsBridge.sendCommand({ cmd: 'set_model', model })
                }}
              />
            ) : (
              <>
                <ChatPicker
                  templates={templates}
                  selectedTemplate={selectedTemplate}
                  onSelectedTemplateChange={setSelectedTemplate}
                  models={filteredModels}
                  languageModel={languageModel}
                  onLanguageModelChange={handleLanguageModelChange}
                />
                <ChatSettings
                  languageModel={languageModel}
                  onLanguageModelChange={handleLanguageModelChange}
                  apiKeyConfigurable={!process.env.NEXT_PUBLIC_NO_API_KEY_INPUT}
                  baseURLConfigurable={!process.env.NEXT_PUBLIC_NO_BASE_URL_INPUT}
                  useMorphApply={useMorphApply}
                  onUseMorphApplyChange={setUseMorphApply}
                />
              </>
            )}
          </ChatInput>
          </div>
        </div>
        {sidePaneMode === 'workspace' ? (
          <AgentOsWorkspace projectId={agentOsProjectId} />
        ) : sidePaneMode === 'preview' ? (
          <Preview
            teamID={userTeam?.id}
            accessToken={session?.access_token}
            selectedTab={currentTab}
            onSelectedTabChange={setCurrentTab}
            isChatLoading={isLoading}
            isPreviewLoading={isPreviewLoading}
            fragment={fragment}
            result={result as ExecutionResult}
            onClose={() => setFragment(undefined)}
          />
        ) : null}
      </div>
    </main>
  )
}

/**
 * Parse user input for slash commands.
 * Returns an AgentOsCommand if matched, 'help' for the /help command,
 * or null if the input is a regular chat message.
 */
function parseSlashCommand(
  input: string,
): AgentOsCommand | 'help' | null {
  if (!input.startsWith('/')) return null

  const parts = input.split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const arg = parts.slice(1).join(' ').trim()

  switch (cmd) {
    case '/enter':
      return arg ? { cmd: 'enter_agent', agent: arg } : null
    case '/exit':
      return { cmd: 'exit_agent' }
    case '/status':
      return { cmd: 'status' }
    case '/skills':
      return { cmd: 'list_skills' }
    case '/resume':
      return arg ? { cmd: 'resume', session_id: arg } : null
    case '/help':
      return 'help'
    default:
      // Unknown slash command — send as regular chat so the agent can handle it
      return null
  }
}

const AGENTOS_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
] as const

const SLASH_COMMANDS = [
  { cmd: '/enter ', label: '/enter <agent>', desc: 'Switch to a specific agent' },
  { cmd: '/exit', label: '/exit', desc: 'Return to the main agent' },
  { cmd: '/status', label: '/status', desc: 'Show bridge & agent status' },
  { cmd: '/skills', label: '/skills', desc: 'List available skills' },
  { cmd: '/resume ', label: '/resume <session_id>', desc: 'Resume a previous session' },
  { cmd: '/help', label: '/help', desc: 'Show help' },
] as const

function SlashSuggestions({
  input,
  agents,
  onSelect,
}: {
  input: string
  agents: Record<string, import('@/lib/agentos-protocol').AgentDetail>
  onSelect: (text: string) => void
}) {
  if (!input.startsWith('/')) return null

  const query = input.toLowerCase()

  // If typing `/enter `, show agent suggestions
  if (query.startsWith('/enter ')) {
    const agentQuery = input.slice(7).toLowerCase()
    const agentNames = ['main', ...Object.keys(agents)]
    const filtered = agentNames.filter((a) => a.toLowerCase().includes(agentQuery))
    if (filtered.length === 0) return null

    return (
      <div className="mb-1 rounded-lg border bg-popover p-1 text-sm shadow-md">
        {filtered.map((name) => (
          <button
            key={name}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-accent"
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(`/enter ${name}`)
            }}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-medium">{name}</span>
            {agents[name] && (
              <span className="truncate text-muted-foreground">{agents[name].description}</span>
            )}
          </button>
        ))}
      </div>
    )
  }

  // General slash command suggestions
  const filtered = SLASH_COMMANDS.filter((c) => c.label.toLowerCase().startsWith(query))
  if (filtered.length === 0 || (filtered.length === 1 && filtered[0].cmd.trim() === input.trim())) {
    return null
  }

  return (
    <div className="mb-1 rounded-lg border bg-popover p-1 text-sm shadow-md">
      {filtered.map((item) => (
        <button
          key={item.cmd}
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left hover:bg-accent"
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(item.cmd)
          }}
        >
          <span className="font-mono font-medium">{item.label}</span>
          <span className="text-muted-foreground">{item.desc}</span>
        </button>
      ))}
    </div>
  )
}

function AgentOsChatBar({
  activeAgent,
  agents,
  model,
  onSwitchAgent,
  onSwitchModel,
}: {
  activeAgent: string | null
  agents: Record<string, import('@/lib/agentos-protocol').AgentDetail>
  model: string
  onSwitchAgent: (agent: string) => void
  onSwitchModel: (model: string) => void
}) {
  const agentLabel = activeAgent ?? 'main'
  const [agentOpen, setAgentOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [agentFilter, setAgentFilter] = useState('')
  const agentRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const agentInputRef = useRef<HTMLInputElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (agentOpen && agentRef.current && !agentRef.current.contains(e.target as Node)) {
        setAgentOpen(false)
      }
      if (modelOpen && modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [agentOpen, modelOpen])

  const modelLabel = AGENTOS_MODELS.find((m) => m.id === model)?.label ?? model

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground select-none">
      {/* Agent picker */}
      <div ref={agentRef} className="relative">
        <button
          type="button"
          onClick={() => { setAgentOpen((v) => { if (!v) setAgentFilter(''); return !v }); setModelOpen(false) }}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-medium text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          {agentLabel}
          <span className="ml-0.5 text-[10px] text-muted-foreground">▾</span>
        </button>
        {agentOpen && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[220px] rounded-lg border bg-popover p-1 text-sm shadow-md z-50">
            <input
              ref={agentInputRef}
              type="text"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && agentFilter.trim()) {
                  onSwitchAgent(agentFilter.trim())
                  setAgentFilter('')
                  setAgentOpen(false)
                }
              }}
              placeholder="Type agent name..."
              className="w-full rounded-md border-0 bg-muted/50 px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/50 mb-1"
              autoFocus
            />
            {['main', ...Object.keys(agents)]
              .filter((name) => !agentFilter || name.toLowerCase().includes(agentFilter.toLowerCase()))
              .map((name) => (
              <button
                key={name}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-accent ${
                  name === agentLabel ? 'bg-accent' : ''
                }`}
                onClick={() => {
                  onSwitchAgent(name)
                  setAgentFilter('')
                  setAgentOpen(false)
                }}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-medium">{name}</span>
                {agents[name] && <span className="truncate text-muted-foreground text-xs">{agents[name].description}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="text-muted-foreground/60">|</span>

      {/* Model picker */}
      <div ref={modelRef} className="relative">
        <button
          type="button"
          onClick={() => { setModelOpen((v) => !v); setAgentOpen(false) }}
          className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors cursor-pointer"
        >
          {modelLabel}
          <span className="text-[10px]">▾</span>
        </button>
        {modelOpen && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[200px] rounded-lg border bg-popover p-1 text-sm shadow-md z-50">
            {AGENTOS_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-accent ${
                  m.id === model ? 'bg-accent' : ''
                }`}
                onClick={() => {
                  onSwitchModel(m.id)
                  setModelOpen(false)
                }}
              >
                <span className="font-mono">{m.label}</span>
                <span className="text-muted-foreground truncate">{m.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}