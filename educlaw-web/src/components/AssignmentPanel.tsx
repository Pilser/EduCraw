import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Circle } from 'lucide-react'
import { api } from '../api/client'
import type { AssignmentProgress } from '../api/types'

interface Props {
  sessionId: string
  token: string
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="w-full bg-wp-border-mid rounded-full h-2">
      <div
        className="bg-wp-accent h-2 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function AssignmentPanel({ sessionId, token }: Props) {
  const [progress, setProgress] = useState<AssignmentProgress | null>(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    api.getProgress(sessionId, token)
      .then(setProgress)
      .catch(() => setProgress(null))
      .finally(() => setLoading(false))

    // Refresh every 30s so scores update as the AI records answers
    const tid = setInterval(() => {
      api.getProgress(sessionId, token).then(setProgress).catch(() => {})
    }, 30_000)
    return () => clearInterval(tid)
  }, [sessionId, token])

  if (loading) return (
    <div className="p-4 text-xs text-wp-text-tertiary text-center">Loading progress…</div>
  )

  if (!progress) return (
    <div className="p-4 text-xs text-wp-text-tertiary text-center">No active assignment</div>
  )

  const pct = progress.max_score === 0
    ? 0
    : Math.round((progress.total_score / progress.max_score) * 100)

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Header */}
      <div>
        <h3 className="font-semibold text-wp-text-primary text-sm truncate">{progress.title}</h3>
        <p className="text-xs text-wp-text-tertiary mt-0.5">
          {progress.submitted
            ? <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-wp-success" /> Submitted</span>
            : `${progress.questions.filter(q => q.answered).length} / ${progress.questions.length} questions answered`}
        </p>
      </div>

      {/* Score bar */}
      <div>
        <div className="flex justify-between text-xs text-wp-text-secondary mb-1">
          <span>Score</span>
          <span className="font-medium">{progress.total_score} / {progress.max_score} pts ({pct}%)</span>
        </div>
        <ProgressBar value={progress.total_score} max={progress.max_score} />
      </div>

      {/* Per-question breakdown */}
      <div className="space-y-2">
        {progress.questions.map(q => (
          <div key={q.question_id} className="flex items-start gap-2">
            <span className="mt-0.5 text-sm shrink-0">
              {!q.answered ? <Circle className="w-4 h-4 text-wp-text-tertiary" /> : q.correct ? <CheckCircle className="w-4 h-4 text-wp-success" /> : <XCircle className="w-4 h-4 text-wp-error" />}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-wp-text-primary truncate">{q.prompt}</p>
              <p className="text-xs text-wp-text-tertiary">
                {q.answered
                  ? `${q.score}/${q.max_points} pts · ${q.attempts} attempt${q.attempts !== 1 ? 's' : ''}`
                  : 'Not answered'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
