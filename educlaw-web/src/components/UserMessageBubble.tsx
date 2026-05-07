/**
 * UserMessageBubble - Isolated component for user message rendering
 * Clean separation to avoid styling conflicts
 */

import { User } from 'lucide-react'
import type { ChatMessage } from '../api/types'

interface UserMessageBubbleProps {
  msg: ChatMessage
}

export default function UserMessageBubble({ msg }: UserMessageBubbleProps) {
  // Extract text content
  const textContent = msg.segments
    .filter(s => s.kind === 'text')
    .map(s => (s.kind === 'text' ? s.content : ''))
    .join('')

  // Extract image segments
  const imageSegments = msg.segments.filter(s => s.kind === 'image')

  return (
    <div className="flex gap-3 flex-row-reverse items-start mb-3">
       {/* Avatar */}
      <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-wp-success text-wp-text-on-accent shadow-sm">
        <User className="w-5 h-5" />
      </div>

      {/* Message Bubble */}
      <div className="max-w-xs sm:max-w-sm md:max-w-xl lg:max-w-2xl rounded-2xl rounded-tr-sm px-5 py-4 bg-wp-success-bg text-wp-text-primary border-2 border-wp-success shadow-md font-medium">
        {/* Text content */}
        {textContent && (
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed mb-3">
            {textContent}
          </p>
        )}

        {/* Images */}
        <div className="space-y-2">
          {imageSegments.length > 0 &&
            imageSegments.map((seg, idx) => {
              // Type guard: ensure it's an image segment
              if (seg.kind !== 'image') return null

              return (
                <img
                  key={idx}
                  src={seg.dataUrl}
                  alt={`Image ${idx + 1}`}
                  className="rounded-wp-md max-w-full h-auto border border-wp-success/30 shadow-sm"
                  style={{ maxHeight: '300px', objectFit: 'contain' }}
                />
              )
            })}
        </div>
      </div>
    </div>
  )
}
