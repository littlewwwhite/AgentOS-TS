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
  CircleNotch,
} from "@phosphor-icons/react";
import { useStudioStore } from "@/stores/studio";
import { inferContentType, type ContentType } from "@/lib/types";
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
    <div className="flex items-center gap-1 border-b border-border bg-card px-3 py-1.5">
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
          <Button variant="ghost" size="icon-xs" aria-label="Copy to clipboard">
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

function MarkdownViewer({ content }: { content: string }) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-6">
        <div className="prose mx-auto max-w-[65ch] text-[14px] leading-relaxed text-foreground">
          <pre className="whitespace-pre-wrap font-sans">{content}</pre>
        </div>
      </div>
    </ScrollArea>
  );
}

function ImageViewer(_props: { path: string }) {
  const characters = [
    { name: "chenwei", span: "col-span-3" },
    { name: "linjia", span: "col-span-2" },
    { name: "zhangming", span: "col-span-2" },
    { name: "suyan", span: "col-span-3" },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="grid w-full max-w-2xl grid-cols-5 gap-3">
        {characters.map(({ name, span }) => (
          <div
            key={name}
            className={cn(
              span,
              "group relative aspect-[4/5] overflow-hidden rounded-lg border border-border bg-secondary",
              "transition-all duration-200 hover:border-ring/50"
            )}
          >
            <div className="flex h-full items-center justify-center">
              <ImageSquare weight="thin" className="size-12 text-muted-foreground transition-transform duration-300 group-hover:scale-105" />
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
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary">
        <FileText weight="thin" className="size-8" />
      </div>
      <div className="space-y-1.5 text-center">
        <p className="text-sm font-medium text-foreground/80">No file selected</p>
        <p className="max-w-[36ch] text-xs leading-relaxed">
          Browse the pipeline to preview files, or start a conversation to generate new content.
        </p>
      </div>
    </div>
  );
}

export function ContentCanvas() {
  const selectedPath = useStudioStore((s) => s.selectedPath);
  const fileContent = useStudioStore((s) => s.fileContent);
  const fileLoading = useStudioStore((s) => s.fileLoading);

  if (!selectedPath) {
    return (
      <div className="flex h-full flex-col bg-background">
        <EmptyCanvas />
      </div>
    );
  }

  const contentType = inferContentType(selectedPath);

  if (fileLoading) {
    return (
      <div className="flex h-full flex-col bg-background">
        <ActionToolbar type={contentType} path={selectedPath} />
        <div className="flex flex-1 items-center justify-center">
          <CircleNotch weight="bold" className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const viewers: Record<ContentType, React.ReactNode> = {
    json: <JsonViewer content={fileContent ?? "{}"} />,
    markdown: <MarkdownViewer content={fileContent ?? ""} />,
    image: <ImageViewer path={selectedPath} />,
    video: <VideoViewer path={selectedPath} />,
    audio: <VideoViewer path={selectedPath} />,
    text: <JsonViewer content={fileContent ?? ""} />,
    unknown: <JsonViewer content={fileContent ?? `// ${selectedPath}\n// Content not available`} />,
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <ActionToolbar type={contentType} path={selectedPath} />
      {viewers[contentType]}
    </div>
  );
}
