import { useSyncBuffer, type SyncStatus } from '#/lib/sync-buffer'

const statusConfig: Record<SyncStatus, { label: string; color: string; bg: string }> = {
  saved:   { label: 'All saved',   color: 'text-green-400',  bg: 'bg-green-500/10' },
  syncing: { label: 'Syncing...',  color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  offline: { label: 'Offline',     color: 'text-red-400',    bg: 'bg-red-500/10' },
  error:   { label: 'Sync error',  color: 'text-red-400',    bg: 'bg-red-500/10' },
}

export function SyncStatusBadge() {
  const { status, pending, nearFull } = useSyncBuffer()
  const cfg = statusConfig[status]

  const dotColor = status === 'saved' ? 'bg-green-400'
    : status === 'syncing' ? 'bg-yellow-400'
    : 'bg-red-400'

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${cfg.color} ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${status === 'syncing' ? 'animate-pulse' : ''}`} />
      <span>{cfg.label}</span>
      {pending > 0 && <span className="font-mono">({pending})</span>}
      {nearFull && <span className="font-semibold text-orange-400">· nearly full</span>}
    </div>
  )
}
