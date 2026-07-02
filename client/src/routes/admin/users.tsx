import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'
import { api, type User } from '#/lib/api'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Alert, AlertDescription } from '#/components/ui/alert'

export const Route = createFileRoute('/admin/users')({ component: UsersPage })

type Tab = 'all' | 'pending' | 'active' | 'rejected'

const STATUS_PARAMS: Record<Tab, { status?: string }> = {
  all: {},
  pending: { status: 'pending' },
  active: { status: 'active' },
  rejected: { status: 'rejected' },
}

function statusBadge(status: User['status']) {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-500/15 text-green-400 border-green-500/20 hover:bg-green-500/20">Active</Badge>
    case 'pending':
      return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20">Pending</Badge>
    case 'rejected':
      return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/20">Rejected</Badge>
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function UsersPage() {
  const [tab, setTab] = useState<Tab>('all')
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.admin.listUsers({ role: 'annotator', ...STATUS_PARAMS[tab] })
      setUsers(data ?? [])
    } catch (err: any) {
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function handleApprove(id: string) {
    setActionLoading(id + ':approve')
    try {
      await api.admin.approveUser(id)
      await fetchUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to approve user')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReject(id: string) {
    setActionLoading(id + ':reject')
    try {
      await api.admin.rejectUser(id)
      await fetchUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to reject user')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this user? This cannot be undone.')) return
    setActionLoading(id + ':delete')
    try {
      await api.admin.deleteUser(id)
      await fetchUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to delete user')
    } finally {
      setActionLoading(null)
    }
  }

  const counts = {
    pending: users.filter(u => u.status === 'pending').length,
    active: users.filter(u => u.status === 'active').length,
    rejected: users.filter(u => u.status === 'rejected').length,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Annotators</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage annotator access requests and accounts.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-4">
        <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending" className="gap-1.5">
              Pending
              {counts.pending > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-semibold rounded-full bg-yellow-500/20 text-yellow-400">
                  {counts.pending}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                  Loading…
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map(user => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-foreground">{user.email}</TableCell>
                  <TableCell>{statusBadge(user.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(user.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {user.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-400 border-green-500/30 hover:bg-green-500/10 hover:text-green-300"
                            disabled={actionLoading !== null}
                            onClick={() => handleApprove(user.id)}
                          >
                            {actionLoading === user.id + ':approve' ? '…' : 'Approve'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                            disabled={actionLoading !== null}
                            onClick={() => handleReject(user.id)}
                          >
                            {actionLoading === user.id + ':reject' ? '…' : 'Reject'}
                          </Button>
                        </>
                      )}
                      {user.status !== 'pending' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive-foreground hover:bg-destructive/10"
                          disabled={actionLoading !== null}
                          onClick={() => handleDelete(user.id)}
                        >
                          {actionLoading === user.id + ':delete' ? '…' : 'Delete'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
