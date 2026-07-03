import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import { api, frameImageUrl, type AnnotatorReviewStats, type ReviewItem, type BoundingBox } from '#/lib/api'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { AnnotationCanvas } from '#/components/annotation'
import { AnnotationToolbar } from '#/components/annotation/AnnotationToolbar'
import { SyncStatusBadge } from '#/components/SyncStatus'
import { useSyncBuffer, isNetworkError } from '#/lib/sync-buffer'
import type { ZoomControl } from '#/components/annotation/types'

export const Route = createFileRoute('/admin/reviews')({ component: ReviewsPage })

const labelColors: Record<string, string> = {
  easy: 'bg-green-500/15 text-green-400 border-green-500/20',
  no_hands: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  occluded: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  low_lighting: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  dexterous_pose: 'bg-red-500/15 text-red-400 border-red-500/20',
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  approved: 'bg-green-500/15 text-green-400 border-green-500/20',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/20',
  corrected: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
}

function ReviewsPage() {
  const navigate = useNavigate()
  const [annotators, setAnnotators] = useState<AnnotatorReviewStats[]>([])
  const [selectedAnnotator, setSelectedAnnotator] = useState<AnnotatorReviewStats | null>(null)
  const [frames, setFrames] = useState<ReviewItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loadingFrames, setLoadingFrames] = useState(false)
  const [boxes, setBoxes] = useState<BoundingBox[]>([])
  const [noHands, setNoHands] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const [reviewNotes, setReviewNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef<ZoomControl>(null)
  const [canvasZoom, setCanvasZoom] = useState(1)
  const { add: bufferAdd } = useSyncBuffer()
  const historyRef = useRef<{ boxes: BoundingBox[] }[]>([])
  const historyIndexRef = useRef(-1)

  function pushHistory(newBoxes: BoundingBox[]) {
    const idx = historyIndexRef.current
    historyRef.current = [...historyRef.current.slice(0, idx + 1), { boxes: newBoxes }]
    historyIndexRef.current = idx + 1
  }

  const handleBoxesChangeReview = useCallback((newBoxes: BoundingBox[]) => {
    setBoxes(newBoxes)
    pushHistory(newBoxes)
  }, [])

  const handleUndoReview = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--
      setBoxes(historyRef.current[historyIndexRef.current].boxes)
    }
  }, [])

  const handleRedoReview = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++
      setBoxes(historyRef.current[historyIndexRef.current].boxes)
    }
  }, [])

  const handleSendToBackReview = useCallback(() => {
    const sid = selectedIdRef.current
    if (!sid) return
    const idx = boxes.findIndex(b => b.id === sid)
    if (idx <= 0) return
    const newBoxes = [...boxes]
    const [moved] = newBoxes.splice(idx, 1)
    newBoxes.unshift(moved)
    setBoxes(newBoxes)
    pushHistory(newBoxes)
  }, [boxes])

  const handleBringToFrontReview = useCallback(() => {
    const sid = selectedIdRef.current
    if (!sid) return
    const idx = boxes.findIndex(b => b.id === sid)
    if (idx < 0 || idx >= boxes.length - 1) return
    const newBoxes = [...boxes]
    const [moved] = newBoxes.splice(idx, 1)
    newBoxes.push(moved)
    setBoxes(newBoxes)
    pushHistory(newBoxes)
  }, [boxes])

  const handleDeleteSelectedReview = useCallback(() => {
    const sid = selectedIdRef.current
    if (sid) {
      const newBoxes = boxes.filter(b => b.id !== sid)
      setBoxes(newBoxes)
      setSelectedId(null)
      pushHistory(newBoxes)
    }
  }, [boxes])

  const handleNoHandsReview = useCallback(() => {
    setNoHands(true)
    setBoxes([])
    setSelectedId(null)
    pushHistory([])
  }, [])

  useEffect(() => {
    api.admin.listReviewAnnotators()
      .then(setAnnotators)
      .catch(() => setError('Failed to load annotators'))
  }, [])

  useEffect(() => {
    if (!selectedAnnotator) return
    setLoadingFrames(true)
    setCurrentIdx(0)
    api.admin.listReviews({ annotator_id: selectedAnnotator.annotator_id, per_page: 200 })
      .then(res => {
        const sorted = res.items
        setFrames(sorted)
        initFrame(sorted, 0)
      })
      .catch(() => setError('Failed to load frames'))
      .finally(() => setLoadingFrames(false))
  }, [selectedAnnotator])

  function initFrame(items: ReviewItem[], idx: number) {
    const item = items[idx]
    if (!item) return
    const corrected = item.corrected_bounding_boxes && item.corrected_bounding_boxes.length > 0
    const hasCorrection = item.review_status === 'corrected' && corrected
    const initialBoxes = hasCorrection ? item.corrected_bounding_boxes : item.bounding_boxes
    setBoxes(initialBoxes)
    setNoHands(hasCorrection ? item.corrected_no_hands : item.no_hands)
    setSelectedId(null)
    setReviewNotes('')
    setError('')
    historyRef.current = [{ boxes: initialBoxes }]
    historyIndexRef.current = 0
  }

  const goTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= frames.length) return
    setCurrentIdx(idx)
    initFrame(frames, idx)
  }, [frames])

  const current = frames[currentIdx] || null

  function effectiveBoxes(item: ReviewItem): BoundingBox[] {
    if (item.review_status === 'corrected' && item.corrected_bounding_boxes?.length > 0) {
      return item.corrected_bounding_boxes
    }
    return item.bounding_boxes
  }

  async function handleSave() {
    if (!current) return
    setSaving(true)
    setError('')
    try {
      await api.admin.updateAnnotation(current.annotation_id, {
        no_hands: noHands,
        bounding_boxes: boxes,
        notes: '',
        review_notes: reviewNotes,
      })
      setReviewNotes('')
      const updated = { ...current, corrected_bounding_boxes: boxes, corrected_no_hands: noHands, review_status: 'corrected' }
      const next = [...frames]
      next[currentIdx] = updated
      setFrames(next)
    } catch (err: any) {
      if (isNetworkError(err)) {
        bufferAdd({ type: 'update', annotationId: current.annotation_id, data: { no_hands: noHands, bounding_boxes: boxes, notes: '', review_notes: reviewNotes } })
        setReviewNotes('')
      } else {
        setError(err.message || 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove() {
    if (!current) return
    setSaving(true)
    setError('')
    try {
      await api.admin.approveAnnotation(current.annotation_id, reviewNotes)
      setReviewNotes('')
      const updated = { ...current, review_status: 'approved' }
      const next = [...frames]
      next[currentIdx] = updated
      setFrames(next)
    } catch (err: any) {
      if (isNetworkError(err)) {
        bufferAdd({ type: 'approve', annotationId: current.annotation_id, review_notes: reviewNotes })
        setReviewNotes('')
      } else {
        setError(err.message || 'Approve failed')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleReject() {
    if (!current) return
    setSaving(true)
    setError('')
    try {
      await api.admin.rejectAnnotation(current.annotation_id, reviewNotes)
      setReviewNotes('')
      const updated = { ...current, review_status: 'rejected' }
      const next = [...frames]
      next[currentIdx] = updated
      setFrames(next)
    } catch (err: any) {
      if (isNetworkError(err)) {
        bufferAdd({ type: 'reject', annotationId: current.annotation_id, review_notes: reviewNotes })
        setReviewNotes('')
      } else {
        setError(err.message || 'Reject failed')
      }
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current) {
        e.preventDefault()
        handleDeleteSelectedReview()
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        handleUndoReview()
      } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        handleRedoReview()
      } else if (e.key === '[' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSendToBackReview()
      } else if (e.key === ']' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleBringToFrontReview()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndoReview, handleRedoReview, handleSendToBackReview, handleBringToFrontReview, handleDeleteSelectedReview])

  if (error && !selectedAnnotator) {
    return (
      <div className="p-6">
        <div className="text-destructive mb-4">{error}</div>
        <Button variant="outline" onClick={() => navigate({ to: '/admin/videos' })}>Back</Button>
      </div>
    )
  }

  if (!selectedAnnotator) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Review Annotations</h1>
          <span className="text-sm text-muted-foreground">{annotators.length} annotator(s)</span>
        </div>

        {annotators.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No completed annotations to review.
          </div>
        )}

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Annotator</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pending</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {annotators.map(a => (
                <tr key={a.annotator_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                        {a.annotator_email.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium">{a.annotator_email}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{a.annotator_email}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{a.total_completed}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm text-yellow-500">{a.pending_review}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" onClick={() => setSelectedAnnotator(a)}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const isLastFrame = currentIdx >= frames.length - 1

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <button onClick={() => setSelectedAnnotator(null)} className="hover:text-foreground">
              Annotators
            </button>
            <span>/</span>
            <span className="text-foreground">{selectedAnnotator.annotator_email}</span>
          </div>
          <h1 className="text-xl font-semibold">
            Reviewing {selectedAnnotator.annotator_email}
          </h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{frames.length} frame{frames.length !== 1 ? 's' : ''}</span>
          <SyncStatusBadge />
        </div>
      </div>

      {loadingFrames && (
        <div className="text-center py-16 text-muted-foreground">Loading frames…</div>
      )}

      {!loadingFrames && frames.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No completed annotations for this annotator.
        </div>
      )}

      {current && (
        <>
          {/* Frame grid — matches annotator queue UI */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
            {frames.map((f, i) => (
              <button
                key={f.annotation_id}
                onClick={() => goTo(i)}
                className={`border rounded-lg overflow-hidden transition-colors text-left ${
                  i === currentIdx
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <div className="aspect-[4/3] bg-muted relative">
                  <img
                    src={frameImageUrl(f.video_stem, f.label, f.filename)}
                    alt={`Frame ${f.frame_index}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {f.review_status !== 'pending' && (
                    <div className={`absolute top-0.5 left-0.5 px-1 py-0.5 rounded text-[8px] font-medium text-white ${
                      f.review_status === 'approved' ? 'bg-green-500/90' :
                      f.review_status === 'rejected' ? 'bg-red-500/90' :
                      'bg-blue-500/90'
                    }`}>
                      {f.review_status === 'corrected' ? 'corr' : f.review_status.slice(0, 3)}
                    </div>
                  )}
                  <div className={`absolute bottom-0.5 right-0.5 px-1 py-0.5 rounded text-[8px] font-medium text-white bg-black/60`}>
                    #{f.frame_index}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Canvas + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={noHands ? 'default' : 'outline'}
                  onClick={handleNoHandsReview}
                  disabled={saving}
                >
                  No Hands
                </Button>
                <AnnotationToolbar
                  boxes={boxes}
                  onBoxesChange={handleBoxesChangeReview}
                  selectedId={selectedId}
                  onSelectedChange={setSelectedId}
                  onUndo={handleUndoReview}
                  onRedo={handleRedoReview}
                  canUndo={historyIndexRef.current > 0}
                  canRedo={historyIndexRef.current < historyRef.current.length - 1}
                  onZoomIn={() => canvasRef.current?.zoomIn()}
                  onZoomOut={() => canvasRef.current?.zoomOut()}
                  onZoomReset={() => canvasRef.current?.zoomReset()}
                  zoom={canvasZoom}
                  disabled={saving}
                  onSendToBack={handleSendToBackReview}
                  onBringToFront={handleBringToFrontReview}
                />
                <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Frame {currentIdx + 1}/{frames.length}</span>
                </div>
              </div>

              <div className="h-[500px] border border-border rounded-lg overflow-hidden">
                <AnnotationCanvas
                  zoomRef={canvasRef}
                  imageUrl={frameImageUrl(current.video_stem, current.label, current.filename)}
                  boxes={boxes}
                  onBoxesChange={handleBoxesChangeReview}
                  selectedId={selectedId}
                  onSelectedChange={setSelectedId}
                  onZoomChange={setCanvasZoom}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="border border-border rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-medium">Details</h3>
                <div className="text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Annotator</span>
                    <span>{selectedAnnotator.annotator_email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Frame #</span>
                    <span className="font-mono">{current.frame_index}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Label</span>
                    <Badge variant="outline" className={`text-[10px] ${labelColors[current.label] || ''}`}>
                      {current.label.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline" className={`text-[10px] ${statusColors[current.review_status] || ''}`}>
                      {current.review_status || 'pending'}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Submitted</span>
                    <span>{new Date(current.created_at * 1000).toLocaleDateString()}</span>
                  </div>
                  {current.reviewed_by_email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reviewed by</span>
                      <span className="text-xs text-muted-foreground">{current.reviewed_by_email}</span>
                    </div>
                  )}
                  {effectiveBoxes(current).length > 0 && (
                    <div className="pt-2 border-t border-border">
                      <span className="text-muted-foreground block mb-1">Boxes ({effectiveBoxes(current).length})</span>
                      <div className="space-y-1">
                        {effectiveBoxes(current).map((box) => (
                          <div key={box.id} className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[7px] font-bold text-white ${box.hand === 'left' ? 'bg-blue-500' : 'bg-orange-500'}`}>
                              {box.hand === 'left' ? 'L' : 'R'}
                            </span>
                            <span className="text-muted-foreground">
                              {(box.x * 100).toFixed(0)}%, {(box.y * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {current.review_status !== 'pending' && current.review_status !== '' && (
                    <div className="pt-2 border-t border-border">
                      <span className="text-muted-foreground text-[10px] block mb-0.5">Review notes</span>
                      <p className="text-xs bg-muted/50 rounded p-1.5">{current.review_notes || '—'}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border border-border rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium">Review</h3>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                  placeholder="Review notes..."
                />
                <Button className="w-full" size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Correction'}
                </Button>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-green-500/30 text-green-500 hover:bg-green-500/10"
                    onClick={handleApprove}
                    disabled={saving}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-red-500/30 text-red-500 hover:bg-red-500/10"
                    onClick={handleReject}
                    disabled={saving}
                  >
                    Reject
                  </Button>
                </div>
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={currentIdx <= 0}
                  onClick={() => goTo(currentIdx - 1)}
                >
                  Previous
                </Button>
                {isLastFrame ? (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => setSelectedAnnotator(null)}
                  >
                    Finish Review
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={currentIdx >= frames.length - 1}
                    onClick={() => goTo(currentIdx + 1)}
                  >
                    Next
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
