'use client'

import Image from 'next/image'

import { RepoBanner } from './repo-banner'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { shouldClearChatInputFiles } from '@/lib/chat-input'
import { isFileInArray } from '@/lib/utils'
import { ArrowUp, FileIcon, Paperclip, Square, Upload, X } from 'lucide-react'
import { SetStateAction, useCallback, useEffect, useMemo, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'

export function ChatInput({
  retry,
  isErrored,
  errorMessage,
  isLoading,
  isRateLimited,
  stop,
  input,
  handleInputChange,
  handleSubmit,
  isMultiModal,
  files,
  handleFileChange,
  children,
}: {
  retry: () => void
  isErrored: boolean
  errorMessage: string
  isLoading: boolean
  isRateLimited: boolean
  stop: () => void
  input: string
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  isMultiModal: boolean
  files: File[]
  handleFileChange: (change: SetStateAction<File[]>) => void
  children: React.ReactNode
}) {
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileChange((prev) => {
      const newFiles = Array.from(e.target.files || [])
      const uniqueFiles = newFiles.filter((file) => !isFileInArray(file, prev))
      return [...prev, ...uniqueFiles]
    })
  }, [handleFileChange])

  const handleFileRemove = useCallback((file: File) => {
    handleFileChange((prev) => prev.filter((f) => f !== file))
  }, [handleFileChange])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)

    for (const item of items) {
      if (item.kind === 'file') {
        e.preventDefault()

        const file = item.getAsFile()
        if (file) {
          handleFileChange((prev) => {
            if (!isFileInArray(file, prev)) {
              return [...prev, file]
            }
            return prev
          })
        }
      }
    }
  }, [handleFileChange])

  const [dragActive, setDragActive] = useState(false)

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedFiles = Array.from(e.dataTransfer.files)

    if (droppedFiles.length > 0) {
      handleFileChange((prev) => {
        const uniqueFiles = droppedFiles.filter(
          (file) => !isFileInArray(file, prev),
        )
        return [...prev, ...uniqueFiles]
      })
    }
  }, [handleFileChange])

  const filePreviewItems = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    [files],
  )

  useEffect(() => {
    return () => {
      for (const previewFile of filePreviewItems) {
        URL.revokeObjectURL(previewFile.url)
      }
    }
  }, [filePreviewItems])

  const formatFileSize = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`
  }, [])

  const filePreview = useMemo(() => {
    if (files.length === 0) return null
    return filePreviewItems.map(({ file, url }) => {
      const isImage = file.type.startsWith('image/')
      return (
        <div className="relative group" key={file.name}>
          {isImage ? (
            <div className="relative rounded-lg overflow-hidden w-12 h-12 border border-border/50">
              <Image
                unoptimized
                src={url}
                alt={file.name}
                width={48}
                height={48}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleFileRemove(file)}
                className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/50 px-2 py-1.5 pr-1">
              <FileIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-[11px] text-foreground max-w-[80px] truncate">
                {file.name}
              </span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {formatFileSize(file.size)}
              </span>
              <button
                type="button"
                onClick={() => handleFileRemove(file)}
                className="p-0.5 rounded hover:bg-muted-foreground/20 transition-colors"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>
      )
    })
  }, [filePreviewItems, files.length, handleFileRemove, formatFileSize])

  const onEnter = useCallback((e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (e.currentTarget.checkValidity()) {
        handleSubmit(e)
      } else {
        e.currentTarget.reportValidity()
      }
    }
  }, [handleSubmit])

  useEffect(() => {
    if (shouldClearChatInputFiles(isMultiModal, files.length)) {
      handleFileChange([])
    }
  }, [files.length, handleFileChange, isMultiModal])

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={onEnter}
      className="mb-2 mt-auto flex flex-col bg-background"
      onDragEnter={isMultiModal ? handleDrag : undefined}
      onDragLeave={isMultiModal ? handleDrag : undefined}
      onDragOver={isMultiModal ? handleDrag : undefined}
      onDrop={isMultiModal ? handleDrop : undefined}
    >
      {isErrored && (
        <div
          className={`flex items-center p-1.5 text-sm font-medium mx-4 mb-10 rounded-xl ${
            isRateLimited
              ? 'bg-orange-400/10 text-orange-400'
              : 'bg-red-400/10 text-red-400'
          }`}
        >
          <span className="flex-1 px-1.5">{errorMessage}</span>
          <button
            type="button"
            className={`px-2 py-1 rounded-sm ${
              isRateLimited ? 'bg-orange-400/20' : 'bg-red-400/20'
            }`}
            onClick={retry}
          >
            Try again
          </button>
        </div>
      )}
      <div className="relative">
        <RepoBanner className="absolute bottom-full inset-x-2 translate-y-1 z-0 pb-2" />
        <div
          className={`shadow-md rounded-2xl relative z-10 bg-background border ${
            dragActive
              ? 'border-primary border-dashed'
              : ''
          }`}
        >
          {dragActive && (
            <div className="absolute inset-0 rounded-2xl bg-primary/5 flex items-center justify-center z-20 pointer-events-none">
              <div className="flex flex-col items-center gap-1 text-primary">
                <Upload className="w-5 h-5" />
                <span className="text-xs font-medium">Drop files here</span>
              </div>
            </div>
          )}
          <div className="flex items-center px-3 py-2 gap-1">{children}</div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-1">
              {filePreview}
            </div>
          )}
          <TextareaAutosize
            autoFocus={true}
            id="chat-input"
            name="chat"
            minRows={1}
            maxRows={5}
            className="text-normal px-3 resize-none ring-0 bg-inherit w-full m-0 outline-none"
            required={true}
            placeholder="Describe your app..."
            disabled={isErrored}
            value={input}
            onChange={handleInputChange}
            onPaste={isMultiModal ? handlePaste : undefined}
          />
          <div className="flex p-3 gap-2 items-center">
            <input
              type="file"
              id="multimodal"
              name="multimodal"
              accept="*/*"
              multiple={true}
              className="hidden"
              onChange={handleFileInput}
            />
            <div className="flex items-center flex-1 gap-2">
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      disabled={!isMultiModal || isErrored}
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-xl h-10 w-10"
                      onClick={(e) => {
                        e.preventDefault()
                        document.getElementById('multimodal')?.click()
                      }}
                    >
                      <Paperclip className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Add attachments</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div>
              {!isLoading ? (
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        disabled={isErrored}
                        variant="default"
                        size="icon"
                        type="submit"
                        className="rounded-xl h-10 w-10"
                      >
                        <ArrowUp className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Send message</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="rounded-xl h-10 w-10"
                        onClick={(e) => {
                          e.preventDefault()
                          stop()
                        }}
                      >
                        <Square className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stop generation</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        Fragments is an open-source project made by{' '}
        <a href="https://e2b.dev" target="_blank" className="text-[#ff8800]">
          ✶ E2B
        </a>
      </p>
    </form>
  )
}
