import { LayoutDashboard, GitFork, Shield, Rocket, BarChart3, Activity, Workflow, type LucideIcon } from 'lucide-react'

export interface NavItem { href: string; icon: LucideIcon; label: string }

/**
 * What the product is for right now (2026-10-08 review): deciding what to work on, the factory
 * and its alerts. Triage and Graveyard are reached from the Repositories page; the rest sits in a
 * quieter "More" group. Shared by the sidebar and the mobile menu.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/repos', icon: GitFork, label: 'Repositories' },
  { href: '/agent-performance', icon: Workflow, label: 'Agents' },
  { href: '/security', icon: Shield, label: 'Security' },
]

export const MORE_NAV: NavItem[] = [
  { href: '/deployments', icon: Rocket, label: 'Deployments' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/feed', icon: Activity, label: 'Feed' },
]

/** Exact match, or a sub-page of the item (so /repos/triage and /repos/graveyard highlight Repositories). */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

export interface SidebarStatus {
  /** null = not the factory's owner (no dot shown). */
  factory: { state: 'running' | 'idle' | 'paused' | 'not-set-up'; label: string; detail: string } | null
  /** Short commit of this deployment, or 'dev'. */
  version: string
  /** The public profile URL when it's enabled. */
  publicProfile: string | null
}
