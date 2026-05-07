import { useState, useEffect } from 'react'
import { Maximize2, AlertCircle, Loader, FileText, FileEdit, Image, Code, Settings, Paperclip } from 'lucide-react'
import { api } from '../api/client'
import type { FileNode } from '../api/types'

interface Props {
  fileName: string
  sessionId: string
  token: string
  onOpenFile?: (path: string, name: string, isSubject?: boolean, subjectId?: string) => void
}

function getFileIcon(name: string) {
  if (name.endsWith('.pdf')) return <FileText className="w-5 h-5 text-wp-accent" />
  if (name.endsWith('.md')) return <FileEdit className="w-5 h-5 text-wp-accent" />
  if (name.match(/\.(png|jpg|jpeg|svg|gif|webp)$/)) return <Image className="w-5 h-5 text-wp-accent" />
  if (name.match(/\.(py|rs|js|ts|tsx|jsx)$/)) return <Code className="w-5 h-5 text-wp-accent" />
  if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) return <Settings className="w-5 h-5 text-wp-accent" />
  return <Paperclip className="w-5 h-5 text-wp-accent" />
}

function findFileInTree(tree: FileNode[], targetName: string, parentPath = ''): { path: string; found: boolean } | null {
  for (const node of tree) {
    const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name
    
    if (node.name === targetName) {
      return { path: currentPath, found: true }
    }
    
    if (node.kind === 'dir' && node.children) {
      const result = findFileInTree(node.children, targetName, currentPath)
      if (result?.found) return result
    }
  }
  return null
}

export default function ChatFilePreview({
  fileName,
  sessionId,
  token,
  onOpenFile,
}: Props) {
  const [fileMatch, setFileMatch] = useState<{ path: string; found: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let mounted = true

    const findFile = async () => {
      try {
        // Try to find in student files first
        const files = await api.listStudentFiles(sessionId, token)
        const match = findFileInTree(files, fileName)
        
        if (mounted) {
          if (match?.found) {
            setFileMatch(match)
            setError(false)
          } else {
            setError(true)
          }
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(true)
          setLoading(false)
        }
      }
    }

    findFile()

    return () => {
      mounted = false
    }
  }, [fileName, sessionId, token])

  const handleClick = () => {
    if (fileMatch?.found && onOpenFile) {
      onOpenFile(fileMatch.path, fileName, false)
    }
  }

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-wp-md bg-wp-inset border border-wp-border-soft text-wp-text-secondary text-sm animate-pulse">
        <Loader className="w-4 h-4 animate-spin" />
        <span>{fileName}</span>
      </div>
    )
  }

  if (error || !fileMatch?.found) {
    // File not found - return placeholder
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-wp-md bg-wp-inset border border-wp-border-soft text-wp-text-secondary text-sm">
        <AlertCircle className="w-4 h-4" />
        <span>{fileName}</span>
        <span className="text-xs text-wp-text-tertiary">(not found)</span>
      </div>
    )
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-3 px-4 py-2.5 rounded-wp-md bg-wp-inset border-2 border-wp-border-mid hover:border-wp-accent hover:bg-wp-accent-subtle transition-all group"
      title={`Click to preview ${fileName}`}
    >
        <div className="w-6 h-6 flex items-center justify-center">{getFileIcon(fileName)}</div>
      <div className="text-left">
        <p className="font-semibold text-wp-text-primary text-sm group-hover:text-wp-accent transition-colors">
          {fileName}
        </p>
        <p className="text-xs text-wp-text-tertiary">Click to preview</p>
      </div>
      <Maximize2 className="w-4 h-4 text-wp-text-tertiary group-hover:text-wp-accent ml-auto transition-colors" />
    </button>
  )
}
