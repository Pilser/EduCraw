import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle, XCircle } from 'lucide-react'
import type { MessageSegment } from '../api/types'

type ToolSegment = Extract<MessageSegment, { kind: 'tool' }>

export default function ToolCallCard({ seg }: { seg: ToolSegment }) {
  const [open, setOpen] = useState(false)
  const isOk = seg.exitCode === 0
  const hasOutput = seg.output.trim().length > 0

  return (
    <div className="my-1.5 rounded-wp-lg border border-wp-border-mid text-xs font-mono overflow-hidden not-prose">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-wp-surface-alt hover:bg-wp-accent-subtle transition-colors text-left"
      >
        <span className="text-wp-text-tertiary text-[10px] select-none">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <span className="text-wp-accent font-semibold shrink-0">{seg.tool}</span>
        <span className="text-wp-text-secondary flex-1 truncate">{seg.command}</span>
        {!seg.done ? (
          <span className="text-wp-text-tertiary animate-pulse shrink-0">running…</span>
        ) : (
          <span className={`shrink-0 font-bold flex items-center gap-1 ${isOk ? 'text-wp-success' : 'text-wp-error'}`}>
            {isOk ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            exit {seg.exitCode}
          </span>
        )}
      </button>

      {open && (
        <div className="bg-wp-inset text-wp-text-primary border-t border-wp-border-mid">
          {/* Command */}
          <div className="px-3 py-2 border-b border-wp-border-mid text-wp-text-tertiary">
            <span className="text-wp-text-tertiary select-none">$ </span>
            <span className="text-wp-text-primary">{seg.command}</span>
          </div>
          {/* Output */}
          {hasOutput && (
            <pre className="px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-64">
              {seg.output}
            </pre>
          )}
          {!seg.done && !hasOutput && (
            <div className="px-3 py-2 text-wp-text-tertiary italic">running…</div>
          )}
        </div>
      )}
    </div>
  )
}
