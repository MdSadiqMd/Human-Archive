import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '#/lib/auth'
import { api, frameImageUrl, type QueueItem, type QueueProgress, type BoundingBox } from '#/lib/api'
import { Button } from '#/components/ui/button'
import { AnnotationCanvas, AnnotationToolbar } from '#/components/annotation'
import { SyncStatusBadge } from '#/components/SyncStatus'
import { useSyncBuffer, isNetworkError } from '#/lib/sync-buffer'
import type { ZoomControl } from '#/components/annotation/types'

export const Route = createFileRoute('/annotate/$assignmentId')({ component: AnnotatePage })

interface HistoryEntry {
  boxes: BoundingBox[]
  selectedId: string | null
}

function AnnotatePage() {
  const { assignmentId } = Route.useParams()
  const { user, isLoading: authLoading, logout } = useAuth()
  const navigate = useNavigate()

  const [item, setItem] = useState<QueueItem | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [progress, setProgress] = useState<QueueProgress | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)

  const [boxes, setBoxes] = useState<BoundingBox[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const [noHands, setNoHands] = useState(false)
  const [notes, setNotes] = useState('')

  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const [, forceRender] = useState(0)
  const canvasRef = useRef<ZoomControl>(null)
  const [canvasZoom, setCanvasZoom] = useState(1)
  const { add: bufferAdd } = useSyncBuffer()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user) navigate({ to: '/login' })
    if (user?.role === 'admin') navigate({ to: '/admin/users' })
  }, [user, authLoading])

  const fetchData = useCallback(async () => {
    try {
      const res = await api.queue.list()
      const items = res.items ?? []
      setQueue(items)
      setProgress(res.progress)
      const idx = items.findIndex(i => i.assignment_id === assignmentId)
      if (idx >= 0) {
        setCurrentIdx(idx)
        setItem(items[idx])
      } else if (items.length > 0) {
        navigate({ to: '/annotate/$assignmentId', params: { assignmentId: items[0].assignment_id }, replace: true })
      }
    } catch {
      setError('Failed to load queue')
    }
  }, [assignmentId])

  useEffect(() => {
    if (user) fetchData()
  }, [user, fetchData])

  useEffect(() => {
    setBoxes([])
    setSelectedId(null)
    setNoHands(false)
    setNotes('')
    historyRef.current = [{ boxes: [], selectedId: null }]
    historyIndexRef.current = 0
    forceRender(n => n + 1)
    setError('')
  }, [assignmentId])

  function pushHistory(newBoxes: BoundingBox[], newSelectedId: string | null) {
    const idx = historyIndexRef.current
    historyRef.current = [...historyRef.current.slice(0, idx + 1), { boxes: newBoxes, selectedId: newSelectedId }]
    historyIndexRef.current = idx + 1
  }

  const handleBoxesChange = useCallback((newBoxes: BoundingBox[]) => {
    setBoxes(newBoxes)
    if (newBoxes.length > 0 && noHands) setNoHands(false)
    pushHistory(newBoxes, selectedId)
  }, [noHands, selectedId])

  const handleSelectedChange = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--
      const entry = historyRef.current[historyIndexRef.current]
      setBoxes(entry.boxes)
      setSelectedId(entry.selectedId)
      forceRender(n => n + 1)
    }
  }, [])

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++
      const entry = historyRef.current[historyIndexRef.current]
      setBoxes(entry.boxes)
      setSelectedId(entry.selectedId)
      forceRender(n => n + 1)
    }
  }, [])

  const handleNoHands = useCallback(() => {
    setNoHands(true)
    setBoxes([])
    setSelectedId(null)
    pushHistory([], null)
  }, [pushHistory])

  const handleDeleteSelected = useCallback(() => {
    const sid = selectedIdRef.current
    if (sid) {
      const newBoxes = boxes.filter(b => b.id !== sid)
      setBoxes(newBoxes)
      setSelectedId(null)
      pushHistory(newBoxes, null)
    }
  }, [boxes, pushHistory])

  const handleSetHand = useCallback((hand: 'left' | 'right') => {
    if (selectedId) {
      const newBoxes = boxes.map(b =>
        b.id === selectedId ? { ...b, hand } : b
      )
      setBoxes(newBoxes)
      pushHistory(newBoxes, selectedId)
    }
  }, [boxes, selectedId, pushHistory])

  const handleSendToBack = useCallback(() => {
    if (!selectedId) return
    const idx = boxes.findIndex(b => b.id === selectedId)
    if (idx <= 0) return
    const newBoxes = [...boxes]
    const [moved] = newBoxes.splice(idx, 1)
    newBoxes.unshift(moved)
    setBoxes(newBoxes)
    pushHistory(newBoxes, selectedId)
  }, [boxes, selectedId, pushHistory])

  const handleBringToFront = useCallback(() => {
    if (!selectedId) return
    const idx = boxes.findIndex(b => b.id === selectedId)
    if (idx < 0 || idx >= boxes.length - 1) return
    const newBoxes = [...boxes]
    const [moved] = newBoxes.splice(idx, 1)
    newBoxes.push(moved)
    setBoxes(newBoxes)
    pushHistory(newBoxes, selectedId)
  }, [boxes, selectedId, pushHistory])

  async function handleSubmit() {
    if (!item) return
    if (!noHands && boxes.length === 0) {
      setError('Draw at least one bounding box or mark "No hands"')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.queue.submit(item.assignment_id, {
        no_hands: noHands,
        bounding_boxes: boxes,
        notes,
      })
      setSubmitting(false)
      await advance()
    } catch (err: any) {
      if (isNetworkError(err)) {
        bufferAdd({ type: 'submit', assignmentId: item.assignment_id, data: { no_hands: noHands, bounding_boxes: boxes, notes } })
        setSubmitting(false)
        await advance()
      } else {
        setError(err.message || 'Submit failed')
        setSubmitting(false)
      }
    }
  }

  async function handleSkip() {
    if (!item) return
    setSubmitting(true)
    setError('')
    try {
      await api.queue.skip(item.assignment_id)
      setSubmitting(false)
      await advance()
    } catch (err: any) {
      if (isNetworkError(err)) {
        bufferAdd({ type: 'skip', assignmentId: item.assignment_id })
        setSubmitting(false)
        await advance()
      } else {
        setError(err.message || 'Skip failed')
        setSubmitting(false)
      }
    }
  }

  async function advance() {
    const next = [...queue]
    next.splice(currentIdx, 1)
    setQueue(next)
    if (next.length > 0) {
      const nextIdx = Math.min(currentIdx, next.length - 1)
      const nextItem = next[nextIdx]
      setCurrentIdx(nextIdx)
      setItem(nextItem)
      navigate({ to: '/annotate/$assignmentId', params: { assignmentId: nextItem.assignment_id }, replace: true })
    } else {
      setItem(null)
      navigate({ to: '/dashboard' })
    }
    setSubmitting(false)
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleNoHands()
      } else if (e.key === 'l' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleSetHand('left')
      } else if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleSetHand('right')
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current) {
        e.preventDefault()
        handleDeleteSelected()
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        handleRedo()
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleSkip()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setSelectedId(null)
      } else if (e.key === '[' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSendToBack()
      } else if (e.key === ']' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleBringToFront()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [boxes, noHands, handleNoHands, handleSetHand, handleDeleteSelected, handleUndo, handleRedo, handleSendToBack, handleBringToFront])

  function handleLogout() {
    logout()
    navigate({ to: '/login' })
  }

  if (authLoading || !user) return null

  if (!item) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <h1 className="text-lg font-semibold">All done!</h1>
          <p className="text-sm text-muted-foreground">No more frames to annotate.</p>
          <Button onClick={() => navigate({ to: '/dashboard' })}>Back to dashboard</Button>
        </div>
      </div>
    )
  }

  const pct = progress && progress.total > 0
    ? Math.round((progress.completed + progress.skipped) / progress.total * 100)
    : 0

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/50 bg-background sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
            </svg>
            <span className="font-semibold text-sm">Human Archive</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Frame {currentIdx + 1} of {queue.length + currentIdx + 1}</span>
              <span>·</span>
              <span>{progress?.completed ?? 0} / {progress?.total ?? 0} ({pct}%)</span>
            </div>
            <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <SyncStatusBadge />
            <span className="text-xs text-muted-foreground hidden sm:block">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex">
        <div className="flex-1 p-4">
          {error && (
            <div className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div className="h-[calc(100vh-180px)] min-h-[400px]">
            <AnnotationCanvas
              zoomRef={canvasRef}
              imageUrl={frameImageUrl(item.video_stem, item.label, item.filename)}
              boxes={boxes}
              onBoxesChange={handleBoxesChange}
              selectedId={selectedId}
              onSelectedChange={handleSelectedChange}
              onZoomChange={setCanvasZoom}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {item.video_stem} · Frame #{item.frame_index} · t={item.timestamp_s.toFixed(2)}s
          </p>
        </div>

        <div className="w-72 border-l border-border p-4 flex flex-col gap-4">
          <Button
            variant={noHands ? 'default' : 'outline'}
            className="w-full"
            onClick={handleNoHands}
            disabled={submitting}
          >
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            No Hands
            <span className="ml-auto text-xs opacity-60">n</span>
          </Button>

          <AnnotationToolbar
            boxes={boxes}
            selectedId={selectedId}
            onSelectedChange={setSelectedId}
            onBoxesChange={handleBoxesChange}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyIndexRef.current > 0}
            canRedo={historyIndexRef.current < historyRef.current.length - 1}
            onZoomIn={() => canvasRef.current?.zoomIn()}
            onZoomOut={() => canvasRef.current?.zoomOut()}
            onZoomReset={() => canvasRef.current?.zoomReset()}
            zoom={canvasZoom}
            disabled={submitting}
            onSendToBack={handleSendToBack}
            onBringToFront={handleBringToFront}
          />

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              placeholder="Any observations..."
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || (!noHands && boxes.length === 0)}
            >
              {submitting ? 'Saving...' : 'Submit & Next'}
              <span className="ml-auto text-xs opacity-60">Enter</span>
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSkip}
              disabled={submitting}
            >
              Skip
              <span className="ml-auto text-xs opacity-60">s</span>
            </Button>
          </div>

          <div className="flex-1" />

          <div className="text-[10px] text-muted-foreground space-y-1">
            <p className="font-medium mb-1">Keyboard shortcuts</p>
            <p>Draw: click + drag</p>
            <p>Select: click box</p>
            <p>Move: drag selected box</p>
            <p>Resize: drag handles / Rotate: drag ○</p>
            <p>Pan: space + drag</p>
            <p>Zoom: scroll wheel</p>
            <p className="mt-1">l / r: set hand · Del: delete</p>
            <p>Ctrl+Z: undo · Ctrl+Shift+Z: redo</p>
            <p>Ctrl+[ : send to back · Ctrl+] : bring to front</p>
          </div>
        </div>
      </main>
    </div>
  )
}
