import { agentOsFetch } from './agentos'

export const DEFAULT_UPLOAD_ROOT = '/home/user/app/workspace'

export function getUploadTargetDirectory(
  selectedPath: string | null,
): string {
  if (!selectedPath) return DEFAULT_UPLOAD_ROOT
  // If selectedPath looks like a file, use its parent directory
  const lastSlash = selectedPath.lastIndexOf('/')
  if (lastSlash > 0) return selectedPath.slice(0, lastSlash)
  return DEFAULT_UPLOAD_ROOT
}

export async function uploadFiles({
  projectId,
  selectedPath,
  files,
}: {
  projectId: string
  selectedPath: string | null
  files: File[]
}): Promise<string[]> {
  const targetDir = getUploadTargetDirectory(selectedPath)
  const uploaded: string[] = []

  for (const file of files) {
    const remotePath = `${targetDir}/${file.name}`
    const isText = file.type.startsWith('text/') || /\.(txt|md|json|csv|yaml|yml|xml|html|css|js|ts|tsx|jsx|py|sh|sql)$/i.test(file.name)

    let body: Record<string, unknown>

    if (isText) {
      const content = await file.text()
      body = { path: remotePath, content }
    } else {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      body = { path: remotePath, contentBase64: btoa(binary) }
    }

    const response = await agentOsFetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/upload`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      throw new Error(`Upload failed for ${file.name} (${response.status})`)
    }

    uploaded.push(remotePath)
  }

  return uploaded
}
