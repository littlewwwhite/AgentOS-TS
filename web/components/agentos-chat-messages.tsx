// input: AgentOsChatState messages with agentOsBlocks
// output: Rendered chat message list with structured block components
// pos: AgentOS chat view, renders each content block with dedicated component

'use client'

import { useEffect, useRef } from 'react'
import { LoaderIcon } from 'lucide-react'

import { Message } from '@/lib/messages'
import { ContentBlockRenderer } from './agentos-content-blocks'

export function AgentOsChatMessages({
  messages,
  isLoading,
}: {
  messages: Message[]
  isLoading: boolean
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  return (
    <div className="flex flex-col gap-2 pb-4">
      {messages.map((message, index) => (
        <div
          key={index}
          className={
            message.role === 'user'
              ? 'px-4 py-2 rounded-xl w-fit bg-gradient-to-b from-black/5 to-black/10 dark:from-black/30 dark:to-black/50 font-serif'
              : 'px-4 py-4 rounded-2xl w-full bg-accent dark:bg-white/5 border text-accent-foreground dark:text-muted-foreground'
          }
        >
          {message.role === 'assistant' && message.agentOsBlocks ? (
            message.agentOsBlocks.map((block, blockIndex) => (
              <ContentBlockRenderer key={blockIndex} block={block} />
            ))
          ) : (
            message.content.map((block, blockIndex) => {
              if (block.type !== 'text') return null
              if (message.role === 'user') {
                return (
                  <span key={blockIndex} className="whitespace-pre-wrap">
                    {block.text}
                  </span>
                )
              }
              // Fallback for assistant messages without agentOsBlocks (legacy)
              return (
                <div key={blockIndex} className="agentos-md text-sm leading-7">
                  {block.text}
                </div>
              )
            })
          )}
        </div>
      ))}
      {isLoading && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <LoaderIcon strokeWidth={2} className="animate-spin w-4 h-4" />
          <span>Generating...</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
