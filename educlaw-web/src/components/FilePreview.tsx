import { useEffect, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { api } from '../api/client'

interface Props {
  fileName: string
  filePath: string
  sessionId: string
  token: string
  isSubjectFile?: boolean
  subjectId?: string
  onClose: () => void
}

// Shared code-block renderer for ReactMarkdown
const mdCode = ({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
  const match = /language-(\w+)/.exec(className ?? '')
  if (match) {
    return (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{ borderRadius: '0.5rem', fontSize: '0.78rem', margin: '0.5rem 0' }}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    )
  }
  return <code className={`bg-wp-inset text-wp-text-primary px-2 py-1 rounded text-sm font-mono`} {...props}>{children}</code>
}

export default function FilePreview({ fileName, filePath, sessionId, token, isSubjectFile, subjectId }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  const fileTypeRef = useRef<'text' | 'markdown' | 'code' | 'image' | 'pdf' | 'unknown'>('unknown')

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        setError(null)

        // Determine file type from extension
        const lower = fileName.toLowerCase()
        if (lower.endsWith('.md')) {
          fileTypeRef.current = 'markdown'
        } else if (lower.match(/\.(png|jpg|jpeg|gif|svg|webp)$/)) {
          fileTypeRef.current = 'image'
        } else if (lower.endsWith('.pdf')) {
          fileTypeRef.current = 'pdf'
        } else if (lower.match(/\.(py|js|ts|jsx|tsx|rs|go|rb|java|cpp|c|h|java|php|css|html|json|xml|yaml|yml)$/)) {
          fileTypeRef.current = 'code'
        } else if (lower.match(/\.(txt|csv|log|md|rst)$/)) {
          fileTypeRef.current = 'text'
        }

        // Fetch file
        const blob = isSubjectFile
          ? await api.readSubjectFile(subjectId!, filePath, token)
          : await api.readStudentFile(sessionId, filePath, token)

        if (fileTypeRef.current === 'image') {
          const url = URL.createObjectURL(blob)
          setImageUrl(url)
        } else if (fileTypeRef.current === 'pdf') {
          const url = URL.createObjectURL(blob)
          setPdfUrl(url)
        } else {
          const text = await blob.text()
          setContent(text)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        setLoading(false)
      }
    })()

    return () => {
      // Cleanup blob URLs
      if (imageUrl) URL.revokeObjectURL(imageUrl)
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [filePath, sessionId, token, isSubjectFile, subjectId, fileName])

  const fileType = fileTypeRef.current

  return (
    <div className="flex flex-col h-full bg-wp-surface">
      {/* Content - No header since DraggableModal provides it */}
      <div className="flex-1 overflow-auto bg-wp-surface">
        {loading && (
          <div className="flex items-center justify-center h-full text-wp-text-tertiary">
            <div className="text-center">
              <p className="mb-2">Loading file...</p>
              <div className="w-8 h-8 border-4 border-wp-border-mid border-t-wp-accent rounded-full animate-spin mx-auto" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="max-w-md text-center px-4">
              <p className="text-wp-error font-semibold mb-2">Failed to load file</p>
              <p className="text-sm text-wp-text-secondary">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && imageUrl && (
          <div className="flex items-center justify-center h-full p-4 bg-wp-surface-alt">
            <img src={imageUrl} alt={fileName} className="max-w-full max-h-full rounded-wp-lg object-contain" />
          </div>
        )}

        {!loading && !error && pdfUrl && (
          <div className="h-full">
            <iframe
              src={pdfUrl}
              className="w-full h-full"
              title={fileName}
              style={{ border: 'none' }}
            />
          </div>
        )}

        {!loading && !error && fileType === 'markdown' && content && (
          <div className="prose prose-sm max-w-none px-4 py-3 prose-headings:text-wp-text-primary prose-headings:font-bold prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-p:text-wp-text-secondary prose-p:mb-2 prose-ul:text-wp-text-secondary prose-ol:text-wp-text-secondary prose-li:mb-1 prose-code:text-wp-accent prose-code:bg-wp-accent-subtle prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-a:text-wp-accent prose-a:underline prose-blockquote:border-l-wp-accent prose-blockquote:bg-wp-accent-subtle prose-blockquote:px-3 prose-blockquote:py-2 prose-blockquote:rounded-r prose-pre:bg-wp-inset prose-pre:text-wp-text-primary prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:p-3 prose-table:border-collapse prose-td:border prose-td:border-wp-border-mid prose-td:px-3 prose-td:py-2 prose-th:border prose-th:border-wp-border-mid prose-th:px-3 prose-th:py-2 prose-th:bg-wp-surface-alt prose-th:font-semibold">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: mdCode }}>
              {content}
            </ReactMarkdown>
          </div>
        )}

        {!loading && !error && fileType === 'code' && content && (
          <div className="p-4">
            <SyntaxHighlighter
              style={oneDark}
              language={getLanguageFromFileName(fileName)}
              customStyle={{ borderRadius: '0.5rem', fontSize: '0.875rem' }}
              showLineNumbers
              wrapLines
            >
              {content}
            </SyntaxHighlighter>
          </div>
        )}

        {!loading && !error && (fileType === 'text' || fileType === 'unknown') && content && (
          <pre className="p-4 text-xs text-wp-text-secondary font-mono whitespace-pre-wrap break-words bg-wp-surface-alt border-l-4 border-wp-border-mid">
            {content}
          </pre>
        )}
      </div>

      {/* Info footer */}
      {!loading && content && (
        <div className="shrink-0 px-4 py-2 border-t border-wp-border-mid bg-wp-surface-alt text-xs text-wp-text-secondary flex justify-between">
          <span>{fileType === 'unknown' ? 'Unknown file type' : `${fileType.charAt(0).toUpperCase() + fileType.slice(1)} file`}</span>
          <span>{content.length.toLocaleString()} bytes</span>
        </div>
      )}
    </div>
  )
}

function getLanguageFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.rs')) return 'rust'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx')) return 'jsx'
  if (lower.endsWith('.tsx')) return 'tsx'
  if (lower.endsWith('.go')) return 'go'
  if (lower.endsWith('.rb')) return 'ruby'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc')) return 'cpp'
  if (lower.endsWith('.c')) return 'c'
  if (lower.endsWith('.h')) return 'c'
  if (lower.endsWith('.php')) return 'php'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.xml')) return 'xml'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'bash'
  return 'plaintext'
}
