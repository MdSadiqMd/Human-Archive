import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '#/lib/auth'
import { api, frameImageUrl, type QueueItem, type QueueProgress } from '#/lib/api'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'

export const Route = createFileRoute('/dashboard')({ component: DashboardPage })

function DashboardPage() {
  const { user, isLoading, logout } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<QueueItem[]>([])
  const [progress, setProgress] = useState<QueueProgress | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isLoading) return
    if (!user) navigate({ to: '/login' })
    if (user?.role === 'admin') navigate({ to: '/admin/users' })
  }, [user, isLoading])

  const fetchQueue = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await api.queue.list()
      setItems(res.items ?? [])
      setProgress(res.progress)
    } catch {
      // not ready yet
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) fetchQueue()
  }, [user, fetchQueue])

  if (isLoading || !user) return null

  function handleLogout() {
    logout()
    navigate({ to: '/login' })
  }

  const pct = progress && progress.total > 0
    ? Math.round((progress.completed + progress.skipped) / progress.total * 100)
    : 0

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
            </svg>
            <span className="font-semibold text-sm text-foreground">Human Archive</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Annotation queue</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review and annotate frames assigned to you.
            </p>
          </div>

          {progress && progress.total > 0 && (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{progress.completed + progress.skipped} / {progress.total} ({pct}%)</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{progress.pending} pending</span>
                <span>{progress.completed} completed</span>
                <span>{progress.skipped} skipped</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 space-y-3 max-w-sm mx-auto">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted mb-2">
                <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-foreground">All done!</h1>
              <p className="text-sm text-muted-foreground">
                Your queue is empty. An admin will assign more frames to you shortly.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {items.length} frame{items.length !== 1 ? 's' : ''} pending
                </p>
                <Button asChild>
                  <Link to="/annotate/$assignmentId" params={{ assignmentId: items[0].assignment_id }}>
                    Start annotating
                  </Link>
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {items.map(item => (
                  <Link
                    key={item.assignment_id}
                    to="/annotate/$assignmentId"
                    params={{ assignmentId: item.assignment_id }}
                    className="border border-border rounded-lg overflow-hidden hover:border-muted-foreground/30 transition-colors"
                  >
                    <div className="aspect-[4/3] bg-muted">
                      <img
                        src={frameImageUrl(item.video_stem, item.label, item.filename)}
                        alt={`Frame ${item.frame_index}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-2 flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">#{item.frame_index}</span>
                      <Badge variant="outline" className="text-[10px]">{item.label.replace(/_/g, ' ')}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
