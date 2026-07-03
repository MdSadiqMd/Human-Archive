import { Button } from '#/components/ui/button'
import type { BoundingBox } from './types'

interface Props {
  boxes: BoundingBox[]
  selectedId: string | null
  onSelectedChange: (id: string | null) => void
  onBoxesChange: (boxes: BoundingBox[]) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  zoom: number
  disabled?: boolean
  onSendToBack?: () => void
  onBringToFront?: () => void
}

export function AnnotationToolbar({
  boxes,
  selectedId,
  onSelectedChange,
  onBoxesChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoom,
  disabled,
  onSendToBack,
  onBringToFront,
}: Props) {
  const handleDelete = (id: string) => {
    onBoxesChange(boxes.filter(b => b.id !== id))
    if (selectedId === id) onSelectedChange(null)
  }

  const handleToggleHand = (id: string) => {
    onBoxesChange(boxes.map(b =>
      b.id === id ? { ...b, hand: b.hand === 'left' ? 'right' : 'left' } : b
    ))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 border border-border rounded-md">
          <Button
            variant="ghost"
            size="sm"
            onClick={onZoomOut}
            disabled={disabled}
            className="h-8 w-8 p-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </Button>
          <button
            onClick={onZoomReset}
            disabled={disabled}
            className="h-8 px-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onZoomIn}
            disabled={disabled}
            className="h-8 w-8 p-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onUndo}
            disabled={disabled || !canUndo}
            className="h-8 w-8 p-0"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRedo}
            disabled={disabled || !canRedo}
            className="h-8 w-8 p-0"
            title="Redo (Ctrl+Shift+Z)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </Button>
        </div>
        {onSendToBack && onBringToFront && selectedId && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onSendToBack}
              disabled={disabled}
              className="h-8 w-8 p-0"
              title="Send to back"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onBringToFront}
              disabled={disabled}
              className="h-8 w-8 p-0"
              title="Bring to front"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </Button>
          </div>
        )}
      </div>

      {boxes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Boxes ({boxes.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {boxes.map((box, i) => (
              <div
                key={box.id}
                className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors ${
                  selectedId === box.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
                onClick={() => onSelectedChange(box.id)}
              >
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold text-white ${
                    box.hand === 'left' ? 'bg-blue-500' : 'bg-orange-500'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!disabled) handleToggleHand(box.id)
                  }}
                  title="Click to toggle L/R"
                >
                  {box.hand === 'left' ? 'L' : 'R'}
                </span>
                <span className="text-muted-foreground">Box {i + 1}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!disabled) handleDelete(box.id)
                  }}
                  disabled={disabled}
                  className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-50"
                  title="Delete"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
