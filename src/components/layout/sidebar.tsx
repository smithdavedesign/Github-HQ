'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Settings, GitBranch, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MORE_NAV, PRIMARY_NAV, isNavActive, type NavItem, type SidebarStatus } from './nav-items'

const DOT: Record<NonNullable<SidebarStatus['factory']>['state'], string> = {
  running: 'bg-emerald-400',
  idle: 'bg-amber-400',
  paused: 'bg-sky-400',
  'not-set-up': 'bg-white/30',
}

function NavLink({ item, active, muted }: { item: NavItem; active: boolean; muted?: boolean }) {
  const { href, icon: Icon, label } = item
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 px-2.5 rounded-md font-medium transition-all duration-100',
        muted ? 'py-1.5 text-[12px]' : 'py-2 text-[13px]',
        active
          ? 'bg-white/10 text-white shadow-sm'
          : muted ? 'text-white/35 hover:text-white/70 hover:bg-white/[0.05]' : 'text-white/45 hover:text-white/80 hover:bg-white/[0.05]',
      )}
    >
      <Icon className={cn(muted ? 'w-3.5 h-3.5' : 'w-4 h-4', 'shrink-0', active ? 'text-white' : 'text-white/40')} />
      {label}
    </Link>
  )
}

export function Sidebar({ status }: { status: SidebarStatus }) {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex flex-col w-[220px] shrink-0 h-screen sticky top-0 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
            <GitBranch className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-[13px] text-white tracking-tight">RepoHQ</span>
        </Link>
      </div>

      {/* Nav: what the product is for, then a quieter "More" group */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto" aria-label="Main">
        {PRIMARY_NAV.map(item => <NavLink key={item.href} item={item} active={isNavActive(pathname, item.href)} />)}
        <p className="px-2 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-widest text-white/25 select-none">More</p>
        {MORE_NAV.map(item => <NavLink key={item.href} item={item} active={isNavActive(pathname, item.href)} muted />)}
      </nav>

      {/* Footer: factory status, settings, version */}
      <div className="px-3 pb-3 pt-3 border-t border-sidebar-border space-y-1">
        {status.factory && (
          <Link
            href="/agent-performance"
            title={status.factory.detail}
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] text-white/50 hover:text-white/80 hover:bg-white/[0.05]"
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', DOT[status.factory.state])} aria-hidden />
            {status.factory.label}
          </Link>
        )}
        <NavLink item={{ href: '/settings', icon: Settings, label: 'Settings' }} active={pathname === '/settings'} />
        <div className="flex items-center justify-between gap-2 px-2.5 pt-1 text-[10px] text-white/25">
          <span className="font-mono" title="Deployed commit">{status.version}</span>
          {status.publicProfile && (
            <a href={status.publicProfile} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 hover:text-white/60">
              Public profile <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      </div>
    </aside>
  )
}
