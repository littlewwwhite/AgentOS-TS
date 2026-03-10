"use client";

import { RotateCcw } from "lucide-react";
import Logo from "@/components/fragments/logo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function NavBar({
  projectId,
  connection,
  onRefreshFiles,
}: {
  projectId: string;
  connection: string;
  onRefreshFiles: () => void;
}) {
  return (
    <nav className="flex w-full bg-background py-4">
      <div className="flex flex-1 items-center gap-2">
        <div className="flex items-center gap-2">
          <Logo style="fragments" width={22} height={22} />
          <h1 className="whitespace-pre text-sm font-medium md:text-base">AgentOS by </h1>
        </div>
        <span className="underline decoration-[rgba(229,123,0,.3)] decoration-2 text-[#ff8800]">
          Fragments UI
        </span>
      </div>
      <div className="flex items-center gap-2 md:gap-3">
        <span className="hidden text-xs text-muted-foreground md:inline">{projectId}</span>
        <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
          {connection}
        </span>
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onRefreshFiles}>
                <RotateCcw className="h-4 w-4 md:h-5 md:w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh files</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </nav>
  );
}
