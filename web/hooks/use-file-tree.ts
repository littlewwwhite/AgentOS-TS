"use client";

import { useCallback, useEffect, useState } from "react";
import { getServerBaseUrl } from "@/hooks/use-sandbox-connection";

export interface FileTreeEntry {
  name: string;
  path: string;
  type?: string;
  size?: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children: FileTreeNode[];
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return "/";
  }
  return normalized.slice(0, slashIndex);
}

function buildTree(entries: FileTreeEntry[], rootPath: string): FileTreeNode[] {
  const nodes = new Map<string, FileTreeNode>();
  const roots: FileTreeNode[] = [];

  const sortedEntries = [...entries]
    .filter((entry) => entry.path !== rootPath)
    .sort((left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path));

  for (const entry of sortedEntries) {
    const node: FileTreeNode = {
      name: entry.name,
      path: entry.path,
      type: entry.type === "dir" ? "dir" : "file",
      size: entry.size,
      children: [],
    };
    nodes.set(entry.path, node);

    const parentPath = dirname(entry.path);
    const parent = nodes.get(parentPath);
    if (!parent || parentPath === rootPath) {
      roots.push(node);
      continue;
    }

    parent.children.push(node);
  }

  const sortNodes = (items: FileTreeNode[]) => {
    items.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "dir" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    for (const item of items) {
      sortNodes(item.children);
    }
  };

  sortNodes(roots);
  return roots;
}

export function findFirstFile(nodes: FileTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") {
      return node.path;
    }
    const child = findFirstFile(node.children);
    if (child) {
      return child;
    }
  }
  return null;
}

export function useFileTree(
  projectId: string,
  enabled: boolean,
  rootPath: string,
) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/files/tree?path=${encodeURIComponent(rootPath)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`Failed to load file tree (${response.status})`);
      }

      const payload = (await response.json()) as { entries: FileTreeEntry[] };
      setTree(buildTree(payload.entries, rootPath));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, rootPath]);

  useEffect(() => {
    if (!enabled) {
      setTree([]);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return {
    tree,
    loading,
    error,
    refresh,
  };
}
