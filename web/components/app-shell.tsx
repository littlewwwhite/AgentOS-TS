"use client";

import { useState } from "react";
import { useAgentOsRuntime } from "@/app/runtime-provider";
import { Chat } from "@/components/fragments/chat";
import { ChatInput } from "@/components/fragments/chat-input";
import { NavBar } from "@/components/fragments/navbar";
import { ActivityFeed } from "@/components/workbench/activity-feed";
import { AgentTabs } from "@/components/workbench/agent-tabs";
import { FileBrowser } from "@/components/workbench/file-browser";
import { PreviewPane } from "@/components/workbench/preview-pane";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type InspectorTab = "preview" | "files" | "activity";

export function AppShell() {
  const {
    projectId,
    uiState,
    chatMessages,
    isChatLoading,
    submitPrompt,
    stopPrompt,
    selectedPreviewPath,
    setSelectedPreviewPath,
    setSelectedAgent,
    fileTree,
    fileTreeLoading,
    fileTreeError,
    refreshFiles,
    currentTimeline,
  } = useAgentOsRuntime();
  const [chatInput, setChatInput] = useState("");
  const [selectedTab, setSelectedTab] = useState<InspectorTab>("preview");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextInput = chatInput.trim();
    if (!nextInput) {
      return;
    }

    await submitPrompt(nextInput);
    setChatInput("");
  }

  return (
    <main className="flex max-h-screen min-h-screen">
      <div className="grid w-full md:grid-cols-2">
        <div className="mx-auto flex max-h-full w-full max-w-[800px] flex-col overflow-auto px-4">
          <NavBar
            projectId={projectId}
            connection={uiState.connection}
            onRefreshFiles={() => {
              void refreshFiles();
            }}
          />
          <Chat messages={chatMessages} isLoading={isChatLoading} />
          <ChatInput
            isErrored={uiState.connection === "error" && Boolean(uiState.lastError)}
            errorMessage={uiState.lastError ?? ""}
            isLoading={isChatLoading}
            isRateLimited={false}
            stop={() => {
              void stopPrompt();
            }}
            input={chatInput}
            handleInputChange={(event) => setChatInput(event.target.value)}
            handleSubmit={handleSubmit}
          >
            <AgentTabs
              agents={uiState.availableAgents}
              activeAgent={uiState.activeAgent}
              selectedAgent={uiState.selectedAgent}
              onSelect={setSelectedAgent}
            />
          </ChatInput>
        </div>

        <div className="absolute left-0 top-0 z-10 h-full w-full overflow-auto bg-popover shadow-2xl md:relative md:rounded-bl-3xl md:rounded-tl-3xl md:border-l md:border-y">
          <Tabs
            value={selectedTab}
            onValueChange={(value) => setSelectedTab(value as InspectorTab)}
            className="flex h-full flex-col items-start justify-start"
          >
            <div className="grid w-full grid-cols-3 items-center border-b p-2">
              <div className="px-2 text-xs text-muted-foreground">{uiState.selectedAgent}</div>
              <div className="flex justify-center">
                <TabsList className="h-8 border px-1 py-0">
                  <TabsTrigger
                    className="flex items-center gap-1 px-2 py-1 text-xs font-normal"
                    value="preview"
                  >
                    Preview
                  </TabsTrigger>
                  <TabsTrigger
                    className="flex items-center gap-1 px-2 py-1 text-xs font-normal"
                    value="files"
                  >
                    Files
                  </TabsTrigger>
                  <TabsTrigger
                    className="flex items-center gap-1 px-2 py-1 text-xs font-normal"
                    value="activity"
                  >
                    Activity
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="truncate px-2 text-right text-xs text-muted-foreground">
                {selectedPreviewPath ?? "No file selected"}
              </div>
            </div>
            <div className="h-full w-full overflow-y-auto">
              <TabsContent value="preview" className="mt-0 h-full w-full p-4">
                <PreviewPane projectId={projectId} selectedPath={selectedPreviewPath} />
              </TabsContent>
              <TabsContent value="files" className="mt-0 h-full w-full p-4">
                <FileBrowser
                  nodes={fileTree}
                  selectedPath={selectedPreviewPath}
                  onSelectPath={(nextPath) => {
                    setSelectedPreviewPath(nextPath);
                    setSelectedTab("preview");
                  }}
                  onRefresh={() => {
                    void refreshFiles();
                  }}
                  loading={fileTreeLoading}
                  error={fileTreeError}
                />
              </TabsContent>
              <TabsContent value="activity" className="mt-0 h-full w-full p-4">
                <ActivityFeed items={currentTimeline} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </main>
  );
}
