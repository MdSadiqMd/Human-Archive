import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { AnnotationInput, BoundingBox } from './api'

const STORAGE_KEY = 'sync_buffer'
const MAX_ENTRIES = 100
const WARN_PCT = 0.8
const RETRY_INTERVAL_MS = 5000

export type BufferOp =
  | { type: 'submit'; assignmentId: string; data: AnnotationInput }
  | { type: 'skip'; assignmentId: string }
  | { type: 'update'; annotationId: string; data: { no_hands: boolean; bounding_boxes: BoundingBox[]; notes: string; review_notes: string } }
  | { type: 'approve'; annotationId: string; review_notes: string }
  | { type: 'reject'; annotationId: string; review_notes: string }

interface BufferEntry {
  id: string
  op: BufferOp
  timestamp: number
}

export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'error'

interface SyncContextValue {
  pending: number
  capacity: number
  nearFull: boolean
  status: SyncStatus
  add: (op: BufferOp) => void
  flush: () => Promise<void>
}

const SyncContext = createContext<SyncContextValue>({
  pending: 0,
  capacity: MAX_ENTRIES,
  nearFull: false,
  status: 'saved',
  add: () => {},
  flush: async () => {},
})

function load(): BufferEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function save(entries: BufferEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function dispatchChanged() {
  window.dispatchEvent(new CustomEvent('sync-buffer-changed'))
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && (
    err.message === 'Failed to fetch' ||
    err.message.includes('NetworkError') ||
    err.message.toLowerCase().includes('network') ||
    err.message.toLowerCase().includes('fetch')
  ))
}

async function replayOp(op: BufferOp): Promise<void> {
  const { api } = await import('./api')
  switch (op.type) {
    case 'submit': await api.queue.submit(op.assignmentId, op.data); break
    case 'skip': await api.queue.skip(op.assignmentId); break
    case 'update': await api.admin.updateAnnotation(op.annotationId, op.data); break
    case 'approve': await api.admin.approveAnnotation(op.annotationId, op.review_notes); break
    case 'reject': await api.admin.rejectAnnotation(op.annotationId, op.review_notes); break
  }
}

export function SyncBufferProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine)
  const [entries, setEntries] = useState<BufferEntry[]>(load)
  const [flushing, setFlushing] = useState(false)
  const flushingRef = useRef(false)

  const refresh = useCallback(() => setEntries(load()), [])

  const add = useCallback((op: BufferOp) => {
    setEntries(prev => {
      if (prev.length >= MAX_ENTRIES) return prev
      const next = [...prev, { id: crypto.randomUUID(), op, timestamp: Date.now() }]
      save(next)
      dispatchChanged()
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id)
      save(next)
      return next
    })
  }, [])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    setFlushing(true)
    try {
      const current = load()
      for (const entry of current) {
        try {
          await replayOp(entry.op)
          remove(entry.id)
        } catch {
          break
        }
      }
    } finally {
      flushingRef.current = false
      setFlushing(false)
    }
  }, [remove])

  useEffect(() => {
    const onOnline = () => { setOnline(true); refresh() }
    const onOffline = () => setOnline(false)
    const onChanged = () => refresh()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('sync-buffer-changed', onChanged)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('sync-buffer-changed', onChanged)
    }
  }, [refresh])

  useEffect(() => {
    if (online && entries.length > 0 && !flushingRef.current) flush()
  }, [online, entries.length, flush])

  useEffect(() => {
    if (!online) return
    const id = setInterval(() => {
      const current = load()
      if (current.length > 0 && !flushingRef.current) flush()
    }, RETRY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [online, flush])

  let status: SyncStatus = 'saved'
  if (flushing) status = 'syncing'
  else if (entries.length > 0 && !online) status = 'offline'
  else if (entries.length > 0) status = 'syncing'

  return (
    <SyncContext.Provider value={{
      pending: entries.length,
      capacity: MAX_ENTRIES,
      nearFull: entries.length >= Math.floor(MAX_ENTRIES * WARN_PCT),
      status,
      add,
      flush,
    }}>
      {children}
    </SyncContext.Provider>
  )
}

export function useSyncBuffer() {
  return useContext(SyncContext)
}
