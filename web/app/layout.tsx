import type { Metadata } from "next";
import { AgentOsRuntimeProvider } from "@/app/runtime-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentOS Workbench",
  description: "AgentOS web MVP for E2B-based creative production workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const projectId = process.env.NEXT_PUBLIC_AGENTOS_DEFAULT_PROJECT_ID ?? "demo-project";

  return (
    <html lang="en" className="dark h-dvh">
      <body className="h-dvh overflow-hidden bg-background text-foreground">
        <AgentOsRuntimeProvider projectId={projectId}>{children}</AgentOsRuntimeProvider>
      </body>
    </html>
  );
}
