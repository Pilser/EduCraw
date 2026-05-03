import { useRef, useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  initialWidth?: number
  initialHeight?: number
}

export default function DraggableModal({
  isOpen,
  onClose,
  title,
  children,
  initialWidth,
  initialHeight,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  
  // Calculate responsive sizes based on viewport
  const getResponsiveSizes = () => {
    const isMobile = window.innerWidth < 640
    const isTablet = window.innerWidth < 1024
    
    if (isMobile) {
      return {
        width: Math.min(window.innerWidth - 20, initialWidth || 400),
        height: Math.min(window.innerHeight - 100, initialHeight || 500),
      }
    }
    if (isTablet) {
      return {
        width: Math.min(window.innerWidth - 40, initialWidth || 700),
        height: Math.min(window.innerHeight - 80, initialHeight || 550),
      }
    }
    return {
      width: initialWidth || 900,
      height: initialHeight || 600,
    }
  }

  const [size, setSize] = useState<{ width: number; height: number }>(getResponsiveSizes())
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isResizing, setIsResizing] = useState<string | null>(null)
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 })

  // Center the modal on first open
  useEffect(() => {
    if (isOpen && position.x === 0 && position.y === 0) {
      const sizes = getResponsiveSizes()
      const x = Math.max(10, (window.innerWidth - sizes.width) / 2)
      const y = Math.max(10, (window.innerHeight - sizes.height) / 3)
      setPosition({ x, y })
      setSize(sizes)
    }
  }, [isOpen, initialWidth, initialHeight])

  // Handle window resize for responsiveness
  useEffect(() => {
    const handleResize = () => {
      if (!isOpen) return
      const sizes = getResponsiveSizes()
      // Ensure modal stays within bounds after resize
      setSize({
        width: Math.min(sizes.width, window.innerWidth - position.x - 10),
        height: Math.min(sizes.height, window.innerHeight - position.y - 10),
      })
      setPosition(prev => ({
        x: Math.max(10, Math.min(prev.x, window.innerWidth - 100)),
        y: Math.max(10, Math.min(prev.y, window.innerHeight - 100)),
      }))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isOpen, position])

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!headerRef.current?.contains(e.currentTarget as Node)) return
    if ((e.target as Element)?.closest('button')) return

    setIsDragging(true)
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    })
  }

  const handleResizeStart = (e: React.MouseEvent, edge: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(edge)
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    })
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - size.width))
        const newY = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - size.height))
        setPosition({ x: newX, y: newY })
      }

      if (isResizing) {
        const deltaX = e.clientX - resizeStart.x
        const deltaY = e.clientY - resizeStart.y

        let newWidth = resizeStart.width
        let newHeight = resizeStart.height

        if (isResizing.includes('e')) {
          newWidth = Math.max(400, Math.min(resizeStart.width + deltaX, window.innerWidth - position.x - 20))
        }
        if (isResizing.includes('s')) {
          newHeight = Math.max(300, Math.min(resizeStart.height + deltaY, window.innerHeight - position.y - 20))
        }
        if (isResizing.includes('w')) {
          const maxDelta = resizeStart.width - 400
          const actualDelta = Math.min(deltaX, maxDelta)
          newWidth = resizeStart.width - actualDelta
          setPosition(prev => ({ ...prev, x: Math.max(0, prev.x + actualDelta) }))
        }
        if (isResizing.includes('n')) {
          const maxDelta = resizeStart.height - 300
          const actualDelta = Math.min(deltaY, maxDelta)
          newHeight = resizeStart.height - actualDelta
          setPosition(prev => ({ ...prev, y: Math.max(0, prev.y + actualDelta) }))
        }

        setSize({ width: newWidth, height: newHeight })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(null)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, dragOffset, position, size, resizeStart])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop with low opacity */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Draggable Modal */}
      <div
        ref={modalRef}
        className="fixed bg-wp-surface rounded-wp-lg shadow-2xl flex flex-col border border-wp-border-mid z-50"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
          cursor: isDragging ? 'grabbing' : 'default',
          maxHeight: '95vh',
          maxWidth: '95vw',
        }}
      >
        {/* Header - Draggable */}
        <div
          ref={headerRef}
          onMouseDown={handleMouseDown}
          className="shrink-0 flex items-center justify-between px-3 md:px-5 py-3 md:py-4 border-b-2 border-wp-accent/30 bg-gradient-to-r from-wp-accent via-wp-accent to-wp-accent-hover cursor-grab active:cursor-grabbing rounded-t-lg shadow-md"
        >
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
            <h2 className="text-sm md:text-lg font-bold text-white truncate">{title}</h2>
          </div>

          {/* Close Button - Responsive */}
          <button
            onClick={onClose}
            className="shrink-0 px-3 md:px-5 py-2 md:py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold rounded-wp-md shadow-lg hover:shadow-xl transition-all text-xs md:text-base flex items-center gap-1 md:gap-2 border-2 border-red-700 whitespace-nowrap"
            title="Close (Esc)"
          >
            <X className="w-4 h-4 md:w-5 md:h-5" />
            <span className="hidden sm:inline">CLOSE</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-wp-page rounded-b-lg">
          {children}
        </div>

        {/* Resize Handles */}
        {/* Bottom-right corner */}
        <div
          onMouseDown={e => handleResizeStart(e, 'se')}
          className="absolute bottom-0 right-0 w-6 h-6 bg-blue-400/0 hover:bg-blue-400/30 cursor-se-resize rounded-tl transition-colors"
          style={{ cursor: 'nwse-resize' }}
          title="Drag to resize"
        />

        {/* Bottom edge */}
        <div
          onMouseDown={e => handleResizeStart(e, 's')}
          className="absolute bottom-0 left-6 right-6 h-1 bg-slate-300/0 hover:bg-slate-400/50 cursor-n-resize transition-colors"
          style={{ cursor: 'ns-resize' }}
          title="Drag to resize height"
        />

        {/* Right edge */}
        <div
          onMouseDown={e => handleResizeStart(e, 'e')}
          className="absolute top-6 right-0 bottom-6 w-1 bg-slate-300/0 hover:bg-slate-400/50 cursor-e-resize transition-colors"
          style={{ cursor: 'ew-resize' }}
          title="Drag to resize width"
        />

        {/* Corner indicator */}
        <div className="absolute bottom-1 right-1 text-slate-400 text-xs pointer-events-none select-none">
          {size.width} × {size.height}
        </div>
      </div>
    </>
  )
}
