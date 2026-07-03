import { createFileRoute, Outlet, Link, useNavigate, useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuth } from '#/lib/auth'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/admin')({ component: AdminLayout })

const navItems = [
  { to: '/admin/reviews', label: 'Reviews' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/videos', label: 'Videos' },
]

function AdminLayout() {
  const { user, isLoading, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (isLoading) return
    if (!user || user.role !== 'admin') {
      navigate({ to: '/login' })
    }
  }, [user, isLoading])

  if (isLoading || !user) return null

  function handleLogout() {
    logout()
    navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
              </svg>
              <span className="font-semibold text-sm text-foreground">Human Archive</span>
            </div>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const active = location.pathname.startsWith(item.to)
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded-md transition-colors",
                      active
                        ? "bg-primary/10 text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
