"use client";

import { useState, forwardRef } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export const CopyButton = forwardRef<
  HTMLButtonElement,
  {
    variant?: ButtonProps["variant"];
    content: string;
    onCopy?: () => void;
    className?: string;
  }
>(({ variant = "ghost", content, onCopy, className, ...props }, ref) => {
  const [copied, setCopied] = useState(false);

  function copy(nextContent: string) {
    setCopied(true);
    void navigator.clipboard.writeText(nextContent);
    setTimeout(() => setCopied(false), 1000);
    onCopy?.();
  }

  return (
    <Button
      {...props}
      ref={ref}
      variant={variant}
      size="icon"
      className={className}
      onClick={() => copy(content)}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
});

CopyButton.displayName = "CopyButton";
