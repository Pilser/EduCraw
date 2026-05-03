import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Folder, FileText, File, FileJson, FileCode, Image, FileStack } from 'lucide-react'
import { api } from '../api/client'
import type { FileNode } from '../api/types'

interface Props {
  token: string
  sessionId: string
  /** All subject slugs for the student's cohort */
  subjectIds: string[]
  onFileSelect: (path: string, name: string, tab: 'subject' | 'mine', subjectId?: string) => void
}

type Tab = 'subject' | 'mine'

function FileRow({
  node,
  depth,
  onSelect,
  tab,
  subjectId,
}: {
  node: FileNode
  depth: number
  onSelect: (path: string, name: string, tab: 'subject' | 'mine', subjectId?: string) => void
  tab: 'subject' | 'mine'
  subjectId?: string
}) {
  const [open, setOpen] = useState(depth === 0)
  const pad = depth * 12

  if (node.kind === 'dir') {
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full px-1.5 md:px-2 py-0.5 md:py-1 text-xs md:text-sm text-slate-600 hover:bg-slate-100 rounded text-left"
          style={{ paddingLeft: pad + 4 }}
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ChevronDown className="w-3 h-3 opacity-50 shrink-0" /> : <ChevronRight className="w-3 h-3 opacity-50 shrink-0" />}
          <Folder className="w-3 h-3 md:w-4 md:h-4 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map(child => (
          <FileRow key={child.path} node={child} depth={depth + 1} onSelect={onSelect} tab={tab} subjectId={subjectId} />
        ))}
      </div>
    )
  }

  // Get appropriate icon based on file type
  const getFileIcon = () => {
    if (node.name.endsWith('.pdf')) return <FileText className="w-4 h-4 text-red-600" />
    if (node.name.endsWith('.md')) return <FileText className="w-4 h-4 text-blue-600" />
    if (node.name.match(/\.(png|jpg|jpeg|svg|gif|webp)$/)) return <Image className="w-4 h-4 text-green-600" />
    if (node.name.match(/\.(py|rs|js|ts|tsx|jsx)$/)) return <FileCode className="w-4 h-4 text-purple-600" />
    if (node.name.endsWith('.json') || node.name.endsWith('.yaml') || node.name.endsWith('.yml')) return <FileJson className="w-4 h-4 text-orange-600" />
    return <File className="w-4 h-4 text-slate-600" />
  }

  return (
    <button
      className="flex items-center gap-1 md:gap-1.5 w-full px-1.5 md:px-2 py-1 md:py-1.5 text-xs md:text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 rounded text-left transition-colors"
      style={{ paddingLeft: pad + 4 }}
      onClick={() => onSelect(node.path, node.name, tab, tab === 'subject' ? subjectId : undefined)}
    >
      {getFileIcon()}
      <span className="truncate font-medium text-xs md:text-sm">{node.name}</span>
      {node.size !== undefined && (
        <span className="ml-auto text-[10px] md:text-xs text-slate-400 shrink-0">
          {node.size < 1024 ? `${node.size}B` : `${(node.size / 1024).toFixed(1)}K`}
        </span>
      )}
    </button>
  )
}

export default function FileTree({ token, sessionId, subjectIds, onFileSelect }: Props) {
  const [tab, setTab]       = useState<Tab>('mine')
  const [files, setFiles]   = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    const fetchFiles = () => {
      setError('')
      setLoading(true)

      if (tab === 'subject') {
        // Fetch each subject in parallel, then wrap each result as a
        // top-level folder node named after the subject slug.
        if (subjectIds.length === 0) {
          setFiles([])
          setLoading(false)
          return
        }
        Promise.all(
          subjectIds.map(slug =>
            api.listSubjectFiles(slug, token).then(children => ({
              name: slug,
              path: slug,
              kind: 'dir' as const,
              children,
            } satisfies FileNode))
          )
        )
          .then(setFiles)
          .catch(e => setError(e instanceof Error ? e.message : 'Failed to load subjects'))
          .finally(() => setLoading(false))
      } else {
        // My Files — student's persistent upper layer (hidden dirs already excluded server-side)
        api.listStudentFiles(sessionId, token)
          .then(setFiles)
          .catch(e => setError(e instanceof Error ? e.message : 'Failed to load files'))
          .finally(() => setLoading(false))
      }
    }

    fetchFiles()

    // Auto-refresh files every 5 seconds to detect new files created by the backend
    const interval = setInterval(fetchFiles, 5000)

    return () => clearInterval(interval)
  }, [tab, token, subjectIds, sessionId])

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      {/* Tabs - Make prominent with better styling */}
      <div className="border-b-2 border-slate-300 shrink-0 bg-gradient-to-r from-blue-50 to-blue-100">
        {(['subject', 'mine'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center justify-center gap-1 flex-1 py-2 md:py-3 text-xs md:text-sm font-bold transition-all ${
              tab === t
                ? 'text-blue-700 border-b-4 border-blue-600 -mb-0.5 bg-white shadow-md'
                : 'text-slate-600 hover:text-slate-800 hover:bg-blue-50'
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

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1 md:py-2 px-0.5 md:px-1">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-5 h-5 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-[10px] md:text-xs text-slate-500">Loading files…</p>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 md:p-3 text-[10px] md:text-xs text-red-700">
            <p className="font-semibold mb-1">⚠️ Error loading files</p>
            <p>{error}</p>
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 p-2 md:p-4">
            <Folder className="w-8 h-8 md:w-12 md:h-12 mb-2 opacity-30" />
            <p className="text-xs md:text-sm font-medium">No files yet</p>
            <p className="text-[10px] md:text-xs mt-1">Files you create or upload will appear here</p>
          </div>
        )}
        {files.length > 0 && (
          <div className="space-y-0.5">
            {files.map(node => {
              // For subject tab, extract subject ID from the root node (which is named after the subject slug)
              const subId = tab === 'subject' ? node.name : undefined
              return (
                <FileRow key={node.path} node={node} depth={0} onSelect={onFileSelect} tab={tab} subjectId={subId} />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
