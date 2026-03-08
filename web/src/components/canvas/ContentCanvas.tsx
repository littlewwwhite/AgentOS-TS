// input: Selected file path from workspace store
// output: Type-appropriate content viewer with action toolbar
// pos: Center panel — primary content display and manipulation area

import {
  ArrowClockwise,
  PencilSimple,
  MagnifyingGlassPlus,
  Play,
  Copy,
  FileText,
  ImageSquare,
  FilmSlate,
  MusicNote,
  Code,
} from "@phosphor-icons/react";
import { useStudioStore } from "@/stores/studio";
import { inferContentType, type ContentType } from "@/lib/types";
import { MOCK_JSON_CONTENT } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

function ContentIcon({ type }: { type: ContentType }) {
  const map: Record<ContentType, React.ReactNode> = {
    markdown: <FileText weight="duotone" className="size-5" />,
    json: <Code weight="duotone" className="size-5" />,
    image: <ImageSquare weight="duotone" className="size-5" />,
    video: <FilmSlate weight="duotone" className="size-5" />,
    audio: <MusicNote weight="duotone" className="size-5" />,
    text: <FileText weight="duotone" className="size-5" />,
    unknown: <FileText weight="duotone" className="size-5" />,
  };
  return <>{map[type]}</>;
}

function ActionToolbar({
  type,
  path,
}: {
  type: ContentType;
  path: string;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border bg-card/40 px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <ContentIcon type={type} />
        <span className="font-mono text-[12px]">{path}</span>
      </div>
      <div className="flex-1" />
      <Button variant="ghost" size="sm">
        <ArrowClockwise weight="bold" className="size-3.5" /> Regenerate
      </Button>
      <Button variant="ghost" size="sm">
        <PencilSimple weight="bold" className="size-3.5" /> Edit
      </Button>
      {type === "image" && (
        <Button variant="ghost" size="sm">
          <MagnifyingGlassPlus weight="bold" className="size-3.5" /> Upscale
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs">
            <Copy weight="bold" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy</TooltipContent>
      </Tooltip>
    </div>
  );
}

function JsonViewer({ content }: { content: string }) {
  return (
    <ScrollArea className="flex-1">
      <pre className="p-4 font-mono text-[13px] leading-relaxed text-foreground">
        <code>{content}</code>
      </pre>
    </ScrollArea>
  );
}

function MarkdownViewer(_props: { path: string }) {
  const mockContent = `# Episode 01 - New Beginnings

## Scene 1: Office Lobby
**Location:** Startup Incubator, Main Hall
**Time:** Morning

### Actions

**CHEN WEI** walks through the glass doors, carrying a leather briefcase.
His eyes scan the open-plan workspace with a mixture of ambition and uncertainty.

> *Inner thought: Three years of savings, one shot at making this work.*

**LIN JIA** (from behind a standing desk):
"You must be the new tenant in Suite 4B. Coffee machine is broken,
but the WiFi password is on the whiteboard."

---

## Scene 2: Conference Room
**Location:** Suite 4B, Small Meeting Room
**Time:** Late Morning

**ZHANG MING** spreads financial documents across the table.

**ZHANG MING:**
"The runway is exactly 47 days. Not 47 weeks. Days."
`;
  return (
    <ScrollArea className="flex-1">
      <div className="p-6">
        <div className="prose prose-invert mx-auto max-w-[65ch] text-[14px] leading-relaxed text-foreground">
          <pre className="whitespace-pre-wrap font-sans">{mockContent}</pre>
        </div>
      </div>
    </ScrollArea>
  );
}

function ImageViewer(_props: { path: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="grid max-w-2xl grid-cols-2 gap-4">
        {["chenwei", "linjia", "zhangming", "suyan"].map((name) => (
          <div
            key={name}
            className={cn(
              "group relative aspect-[3/4] overflow-hidden rounded-lg border border-border bg-secondary",
              "transition-all hover:border-ring/50"
            )}
          >
            <div className="flex h-full items-center justify-center">
              <ImageSquare weight="thin" className="size-16 text-muted-foreground" />
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/80 to-transparent px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {name}.png
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VideoViewer(_props: { path: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="aspect-video w-full max-w-xl overflow-hidden rounded-lg bg-secondary">
        <div className="flex h-full items-center justify-center">
          <FilmSlate weight="thin" className="size-20 text-muted-foreground" />
        </div>
      </div>
      <div className="flex w-full max-w-xl items-center gap-3">
        <Button variant="secondary" size="icon" className="rounded-full">
          <Play weight="fill" className="size-4" />
        </Button>
        <div className="h-1 flex-1 rounded-full bg-secondary">
          <div className="h-full w-[35%] rounded-full bg-ring" />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          0:00 / 2:34
        </span>
      </div>
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <FileText weight="thin" className="size-16" />
      <p className="text-sm">Select a file to preview</p>
      <p className="max-w-[40ch] text-center text-xs leading-relaxed">
        Use the Pipeline Explorer to browse workspace files, or start a conversation to generate content.
      </p>
    </div>
  );
}

export function ContentCanvas() {
  const selectedPath = useStudioStore((s) => s.selectedPath);

  if (!selectedPath) {
    return (
      <div className="flex h-full flex-col bg-background">
        <EmptyCanvas />
      </div>
    );
  }

  const contentType = inferContentType(selectedPath);

  const viewers: Record<ContentType, React.ReactNode> = {
    json: <JsonViewer content={MOCK_JSON_CONTENT} />,
    markdown: <MarkdownViewer path={selectedPath} />,
    image: <ImageViewer path={selectedPath} />,
    video: <VideoViewer path={selectedPath} />,
    audio: <VideoViewer path={selectedPath} />,
    text: <MarkdownViewer path={selectedPath} />,
    unknown: <JsonViewer content={`// ${selectedPath}\n// Content preview not available`} />,
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <ActionToolbar type={contentType} path={selectedPath} />
      {viewers[contentType]}
    </div>
  );
}
