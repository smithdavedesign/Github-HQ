'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, GitFork, Shield, Rocket,
  BarChart3, Activity, Settings, GitBranch, Skull, ListChecks, Workflow, Menu, X,
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
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
  { href: '/settings', icon: Settings, label: 'Settings' },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden w-8 h-8 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
      >
        <Menu className="w-4 h-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[240px] p-0 bg-sidebar border-sidebar-border">
          <SheetHeader className="px-5 py-4 border-b border-sidebar-border">
            <SheetTitle className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
                <GitBranch className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold text-[13px] text-white tracking-tight">RepoHQ</span>
            </SheetTitle>
          </SheetHeader>

          <nav className="flex-1 px-3 py-3 space-y-0.5">
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-white/25 select-none">
              Navigation
            </p>
            {navItems.map(({ href, icon: Icon, label }) => {
              const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-[13px] font-medium transition-all',
                    active
                      ? 'bg-white/10 text-white'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]',
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-white' : 'text-white/40')} />
                  {label}
                </Link>
              )
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
