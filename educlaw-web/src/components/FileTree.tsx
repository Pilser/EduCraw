import { useState, useRef } from 'react'
import { ChevronDown, ChevronRight, Folder, FileText, File, FileJson, FileCode, Image, FileStack, Upload, AlertCircle, Paperclip } from 'lucide-react'
import { useStudentFileTree, useSubjectFileTree, useUploadStudentFile, useDeleteStudentFile } from '../hooks/useFileSystem'
import type { FileNode } from '../api/types'

interface Props {
  token: string
  sessionId: string
  /** All subject slugs for the student's cohort */
  subjectIds: string[]
  onFileSelect: (path: string, name: string, tab: 'subject' | 'mine', subjectId?: string) => void
  onAttachToChat?: (path: string, name: string, isSubject: boolean, subjectId?: string) => void
}

type Tab = 'subject' | 'mine'

function FileRow({
  node,
  depth,
  onSelect,
  tab,
  subjectId,
  onAttachToChat,
  sessionId,
  token,
}: {
  node: FileNode
  depth: number
  onSelect: (path: string, name: string, tab: 'subject' | 'mine', subjectId?: string) => void
  tab: 'subject' | 'mine'
  subjectId?: string
  onAttachToChat?: (path: string, name: string, isSubject: boolean, subjectId?: string) => void
  sessionId?: string
  token?: string
}) {
  const [open, setOpen] = useState(depth === 0)
  const pad = depth * 12
  const deleteMutation = useDeleteStudentFile(sessionId || '', token || '')

  const handleAttach = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAttachToChat?.(node.path, node.name, tab === 'subject', subjectId)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`Delete ${node.name}?`)) {
      deleteMutation.mutate({ path: node.path })
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/educlaw-file', JSON.stringify({
      path: node.path,
      name: node.name,
      isSubject: tab === 'subject',
      subjectId,
    }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  if (node.kind === 'dir') {
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full px-1.5 md:px-2 py-0.5 md:py-1 text-xs md:text-sm text-wp-text-secondary hover:bg-wp-accent-subtle rounded text-left"
          style={{ paddingLeft: pad + 4 }}
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ChevronDown className="w-3 h-3 opacity-50 shrink-0" /> : <ChevronRight className="w-3 h-3 opacity-50 shrink-0" />}
          <Folder className="w-3 h-3 md:w-4 md:h-4 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map(child => (
          <FileRow key={child.path} node={child} depth={depth + 1} onSelect={onSelect} tab={tab} subjectId={subjectId} onAttachToChat={onAttachToChat} sessionId={sessionId} token={token} />
        ))}
      </div>
    )
  }

  // Get appropriate icon based on file type
  const getFileIcon = () => {
    if (node.name.endsWith('.pdf')) return <FileText className="w-4 h-4 text-wp-accent" />
    if (node.name.endsWith('.md')) return <FileText className="w-4 h-4 text-wp-accent" />
    if (node.name.match(/\.(png|jpg|jpeg|svg|gif|webp)$/)) return <Image className="w-4 h-4 text-wp-accent" />
    if (node.name.match(/\.(py|rs|js|ts|tsx|jsx)$/)) return <FileCode className="w-4 h-4 text-wp-accent" />
    if (node.name.endsWith('.json') || node.name.endsWith('.yaml') || node.name.endsWith('.yml')) return <FileJson className="w-4 h-4 text-wp-accent" />
    return <File className="w-4 h-4 text-wp-accent" />
  }

  return (
    <div className="group flex items-center gap-1 md:gap-1.5 w-full px-1.5 md:px-2 py-1 md:py-1.5 text-xs md:text-sm text-wp-text-primary hover:bg-wp-accent-subtle hover:text-wp-accent rounded transition-colors cursor-pointer"
      style={{ paddingLeft: pad + 4 }}
      onClick={() => onSelect(node.path, node.name, tab, tab === 'subject' ? subjectId : undefined)}
      draggable
      onDragStart={handleDragStart}
    >
      {getFileIcon()}
      <span className="truncate font-medium text-xs md:text-sm flex-1">{node.name}</span>
      {node.size !== undefined && (
        <span className="text-[10px] md:text-xs text-wp-text-tertiary shrink-0">
          {node.size < 1024 ? `${node.size}B` : `${(node.size / 1024).toFixed(1)}K`}
        </span>
      )}
      {/* Attach to Chat button - visible on hover */}
      <button
        onClick={handleAttach}
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-wp-accent/20 rounded transition-opacity shrink-0"
        title="Attach to chat"
      >
        <Paperclip className="w-3 h-3 text-wp-accent" />
      </button>
      {/* Delete button - only for student files */}
      {tab === 'mine' && (
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-wp-error/20 rounded transition-opacity shrink-0"
          title="Delete file"
        >
          <AlertCircle className="w-3 h-3 text-wp-error" />
        </button>
      )}
    </div>
  )
}

export default function FileTree({ token, sessionId, subjectIds, onFileSelect, onAttachToChat }: Props) {
  const [tab, setTab] = useState<Tab>('mine')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const studentQuery = useStudentFileTree(sessionId, token)
  const subjectQuery = useSubjectFileTree(subjectIds, token)
  const uploadMutation = useUploadStudentFile(sessionId, token)

  const files = tab === 'subject' ? subjectQuery.data || [] : studentQuery.data || []
  const isLoading = tab === 'subject' ? subjectQuery.isLoading : studentQuery.isLoading
  const error = tab === 'subject' ? subjectQuery.error : studentQuery.error

  // Handle file upload directly to workspace
  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files
    if (!files || files.length === 0) return

    setUploading(true)
    setUploadError('')

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]

        if (file.size > MAX_FILE_SIZE) {
          setUploadError(`File "${file.name}" exceeds 50MB limit`)
          continue
        }

        const content = await file.arrayBuffer()
        const relativePath = `uploads/${file.name}`
        await uploadMutation.mutateAsync({ path: relativePath, content })
      }

      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="border-b-2 border-wp-border-mid shrink-0 bg-wp-surface-alt">
        {(['subject', 'mine'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center justify-center gap-1 flex-1 py-2 md:py-3 text-xs md:text-sm font-bold transition-all ${
              tab === t
                ? 'text-wp-accent border-b-4 border-wp-accent -mb-0.5 bg-wp-surface shadow-wp-edge'
                : 'text-wp-text-secondary hover:text-wp-text-primary hover:bg-wp-accent-subtle'
            }`}
          >
            {t === 'subject' ? (
              <>
                <Folder className="w-3 h-3 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Subject Files</span>
                <span className="sm:hidden">Subject</span>
              </>
            ) : (
              <>
                <FileStack className="w-3 h-3 md:w-4 md:h-4" />
                <span className="hidden sm:inline">My Files</span>
                <span className="sm:hidden">My</span>
              </>
            )}
          </button>
        ))}
      </div>

      {/* Upload button - show only on "My Files" tab */}
      {tab === 'mine' && (
        <div className="shrink-0 px-2 md:px-3 py-2 border-b border-wp-border-mid bg-wp-accent-subtle">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileUpload}
            className="hidden"
            disabled={uploading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-wp-accent hover:bg-wp-accent-hover active:bg-wp-accent/70 disabled:bg-wp-border-mid text-wp-text-on-accent rounded-wp-md text-xs md:text-sm font-semibold transition-all disabled:cursor-not-allowed"
          >
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Uploading...' : 'Add File'}</span>
          </button>
          {uploadError && (
            <div className="flex items-center gap-1.5 mt-2 p-2 bg-wp-error-bg border border-wp-error rounded-wp-sm text-wp-error text-xs">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1 md:py-2 px-0.5 md:px-1">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-5 h-5 border-2 border-wp-border-mid border-t-wp-accent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-[10px] md:text-xs text-wp-text-tertiary">Loading files…</p>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-wp-error-bg border border-wp-error rounded-wp-sm p-2 md:p-3 text-[10px] md:text-xs text-wp-error">
            <p className="font-semibold mb-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Error loading files</p>
            <p>{String(error)}</p>
          </div>
        )}
        {!isLoading && !error && files.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-wp-text-tertiary p-2 md:p-4">
            <Folder className="w-8 h-8 md:w-12 md:h-12 mb-2 opacity-30" />
            <p className="text-xs md:text-sm font-medium">No files yet</p>
            <p className="text-[10px] md:text-xs mt-1">Files you create or upload will appear here</p>
          </div>
        )}
        {files.length > 0 && (
          <div className="space-y-0.5">
            {files.map(node => {
              const subId = tab === 'subject' ? node.name : undefined
              return (
                <FileRow
                  key={node.path}
                  node={node}
                  depth={0}
                  onSelect={onFileSelect}
                  tab={tab}
                  subjectId={subId}
                  onAttachToChat={onAttachToChat}
                  sessionId={sessionId}
                  token={token}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
