'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, GitFork, Shield, Rocket, BarChart3, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/repos', icon: GitFork, label: 'Repositories' },
  { href: '/security', icon: Shield, label: 'Security' },
  { href: '/deployments', icon: Rocket, label: 'Deployments' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex flex-col w-56 border-r bg-sidebar shrink-0 h-screen sticky top-0">
      <div className="px-4 py-5 border-b">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <GitFork className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-tight">RepoHQ</span>
        </div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="px-2 py-4 border-t">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <Settings className="w-4 h-4 shrink-0" />
          Settings
        </Link>
      </div>
    </aside>
  )
}
