import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { StudioLayout } from "./components/StudioLayout";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioLayout />
  </StrictMode>,
);
