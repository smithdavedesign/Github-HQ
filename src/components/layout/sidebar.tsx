'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, GitFork, Shield, Rocket,
  BarChart3, Activity, Settings, GitBranch, Skull, ListChecks, Workflow,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/repos', icon: GitFork, label: 'Repositories' },
  { href: '/repos/triage', icon: ListChecks, label: 'Triage' },
  { href: '/repos/graveyard', icon: Skull, label: 'Graveyard' },
  { href: '/feed', icon: Activity, label: 'Feed' },
  { href: '/security', icon: Shield, label: 'Security' },
  { href: '/deployments', icon: Rocket, label: 'Deployments' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/agent-performance', icon: Workflow, label: 'Agents' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex flex-col w-[220px] shrink-0 h-screen sticky top-0 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
            <GitBranch className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-[13px] text-white tracking-tight">
            RepoHQ
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-white/25 select-none">
          Overview
        </p>
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-all duration-100',
                active
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-white/45 hover:text-white/80 hover:bg-white/[0.05]',
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-white' : 'text-white/40')} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Settings */}
      <div className="px-3 pb-4 border-t border-sidebar-border pt-3">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-all duration-100',
            pathname === '/settings'
              ? 'bg-white/10 text-white'
              : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]',
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          Settings
        </Link>
      </div>
    </aside>
  )
}
