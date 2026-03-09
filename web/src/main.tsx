// input: Root React component
// output: App shell with global providers
// pos: Entry point — mounts React tree with TooltipProvider

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { StudioLayout } from "./components/StudioLayout";
import { TooltipProvider } from "@/components/ui/tooltip";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <StudioLayout />
    </TooltipProvider>
  </StrictMode>,
);
