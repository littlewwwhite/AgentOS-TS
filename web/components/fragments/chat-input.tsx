"use client";

import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import TextareaAutosize from "react-textarea-autosize";

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
  children,
}: {
  retry?: () => void;
  isErrored: boolean;
  errorMessage: string;
  isLoading: boolean;
  isRateLimited: boolean;
  stop: () => void;
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  function onEnter(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (e.currentTarget.checkValidity()) {
        handleSubmit(e);
      } else {
        e.currentTarget.reportValidity();
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} onKeyDown={onEnter} className="mb-2 mt-auto flex flex-col bg-background">
      {isErrored ? (
        <div
          className={`mx-4 mb-10 flex items-center rounded-xl p-1.5 text-sm font-medium ${
            isRateLimited ? "bg-orange-400/10 text-orange-400" : "bg-red-400/10 text-red-400"
          }`}
        >
          <span className="flex-1 px-1.5">{errorMessage}</span>
          {retry ? (
            <button
              className={`rounded-sm px-2 py-1 ${
                isRateLimited ? "bg-orange-400/20" : "bg-red-400/20"
              }`}
              onClick={retry}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="relative">
        <div className="relative z-10 rounded-2xl border bg-background shadow-md">
          <div className="flex items-center gap-1 overflow-x-auto px-3 py-2">{children}</div>
          <TextareaAutosize
            autoFocus={true}
            minRows={1}
            maxRows={5}
            className="m-0 w-full resize-none bg-inherit px-3 text-normal outline-none ring-0"
            required={true}
            placeholder="Describe your app..."
            disabled={isErrored}
            value={input}
            onChange={handleInputChange}
          />
          <div className="flex items-center justify-end gap-2 p-3">
            {!isLoading ? (
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button type="submit" size="icon" className="h-10 w-10 rounded-xl">
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
                      className="h-10 w-10 rounded-xl"
                      onClick={(e) => {
                        e.preventDefault();
                        stop();
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
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Fragments presentation, AgentOS runtime.
      </p>
    </form>
  );
}
