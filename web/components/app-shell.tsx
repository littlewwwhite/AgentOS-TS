"use client";

import { useEffect, useMemo, useState } from "react";
import { useAgentOsRuntime } from "@/app/runtime-provider";
import { Chat } from "@/components/fragments/chat";
import { ChatInput } from "@/components/fragments/chat-input";
import { NavBar } from "@/components/fragments/navbar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed } from "@/components/workbench/activity-feed";
import { AgentTabs } from "@/components/workbench/agent-tabs";
import { FileBrowser } from "@/components/workbench/file-browser";
import { PreviewPane } from "@/components/workbench/preview-pane";
import {
  getLeafName,
  getPreviewKind,
  hasRenderedPreview,
  shouldUseFragmentCode,
} from "@/lib/preview";

type InspectorTab = "code" | "preview" | "files" | "activity";

function getFallbackTab(selectedPath: string | null): InspectorTab {
  const kind = getPreviewKind(selectedPath);
  if (shouldUseFragmentCode(kind)) {
    return "code";
  }
  if (hasRenderedPreview(kind)) {
    return "preview";
  }
  return "files";
}

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
    serverBaseUrl,
  } = useAgentOsRuntime();
  const [chatInput, setChatInput] = useState("");
  const [selectedTab, setSelectedTab] = useState<InspectorTab>("files");

  const previewKind = getPreviewKind(selectedPreviewPath);
  const canShowCode = shouldUseFragmentCode(previewKind);
  const canShowPreview = hasRenderedPreview(previewKind);
  const fallbackTab = getFallbackTab(selectedPreviewPath);

  useEffect(() => {
    if (selectedTab === "code" && !canShowCode) {
      setSelectedTab(fallbackTab);
      return;
    }
    if (selectedTab === "preview" && !canShowPreview) {
      setSelectedTab(fallbackTab);
    }
  }, [canShowCode, canShowPreview, fallbackTab, selectedTab]);

  const downloadUrl = useMemo(() => {
    if (!selectedPreviewPath) {
      return null;
    }
    return `${serverBaseUrl}/api/projects/${encodeURIComponent(projectId)}/files/download?path=${encodeURIComponent(selectedPreviewPath)}`;
  }, [projectId, selectedPreviewPath, serverBaseUrl]);

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
              <div className="px-2" />
              <div className="flex justify-center">
                <TabsList className="h-8 border px-1 py-0">
                  <TabsTrigger
                    value="code"
                    disabled={!canShowCode}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-normal"
                  >
                    Code
                  </TabsTrigger>
                  <TabsTrigger
                    value="preview"
                    disabled={!canShowPreview}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-normal"
                  >
                    Preview
                  </TabsTrigger>
                  <TabsTrigger
                    value="files"
                    className="flex items-center gap-1 px-2 py-1 text-xs font-normal"
                  >
                    Files
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="flex items-center justify-end gap-2">
                {downloadUrl ? (
                  <Button variant="ghost" size="sm" asChild className="h-8 px-2 text-xs">
                    <a href={downloadUrl} download={getLeafName(selectedPreviewPath)}>
                      Download
                    </a>
                  </Button>
                ) : null}
                <Button
                  variant={selectedTab === "activity" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => {
                    setSelectedTab((current) =>
                      current === "activity" ? fallbackTab : "activity",
                    );
                  }}
                >
                  Activity
                </Button>
              </div>
            </div>
            <div className="h-full w-full overflow-y-auto">
              <TabsContent value="code" className="mt-0 h-full w-full">
                <PreviewPane
                  projectId={projectId}
                  selectedPath={selectedPreviewPath}
                  mode="code"
                />
              </TabsContent>
              <TabsContent value="preview" className="mt-0 h-full w-full">
                <PreviewPane
                  projectId={projectId}
                  selectedPath={selectedPreviewPath}
                  mode="preview"
                />
              </TabsContent>
              <TabsContent value="files" className="mt-0 h-full w-full">
                <FileBrowser
                  nodes={fileTree}
                  selectedPath={selectedPreviewPath}
                  onSelectPath={(nextPath) => {
                    setSelectedPreviewPath(nextPath);
                    setSelectedTab(getFallbackTab(nextPath));
                  }}
                  onRefresh={() => {
                    void refreshFiles();
                  }}
                  loading={fileTreeLoading}
                  error={fileTreeError}
                />
              </TabsContent>
              <TabsContent value="activity" className="mt-0 h-full w-full">
                <ActivityFeed items={currentTimeline} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </main>
  );
}
