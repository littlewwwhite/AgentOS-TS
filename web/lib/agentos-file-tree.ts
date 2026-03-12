export interface AgentOsFileTreeEntry {
  name: string
  path: string
  type?: string
  size?: number
}

export interface AgentOsFileTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children: AgentOsFileTreeNode[]
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex <= 0) {
    return '/'
  }
  return normalized.slice(0, slashIndex)
}

export function buildAgentOsFileTree(
  entries: AgentOsFileTreeEntry[],
  rootPath: string,
): AgentOsFileTreeNode[] {
  const nodes = new Map<string, AgentOsFileTreeNode>()
  const roots: AgentOsFileTreeNode[] = []

  const sortedEntries = [...entries]
    .filter((entry) => entry.path !== rootPath)
    .sort(
      (left, right) =>
        left.path.length - right.path.length ||
        left.path.localeCompare(right.path),
    )

  for (const entry of sortedEntries) {
    const node: AgentOsFileTreeNode = {
      name: entry.name,
      path: entry.path,
      type: entry.type === 'dir' ? 'dir' : 'file',
      size: entry.size,
      children: [],
    }
    nodes.set(entry.path, node)

    const parentPath = dirname(entry.path)
    const parentNode = nodes.get(parentPath)
    if (!parentNode || parentPath === rootPath) {
      roots.push(node)
      continue
    }

    parentNode.children.push(node)
  }

  const sortNodes = (items: AgentOsFileTreeNode[]) => {
    items.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'dir' ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })

    for (const item of items) {
      sortNodes(item.children)
    }
  }

  sortNodes(roots)
  return roots
}

export function findFirstFilePath(
  nodes: AgentOsFileTreeNode[],
): string | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.path
    }

    const nestedPath = findFirstFilePath(node.children)
    if (nestedPath) {
      return nestedPath
    }
  }

  return null
}
