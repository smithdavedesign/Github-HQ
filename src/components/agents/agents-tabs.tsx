'use client'

import { useState, type ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AGENT_TABS, type AgentTab } from '@/lib/agents/agent-tabs'

/**
 * The Agents page in tabs. The server renders every panel; switching is instant and the tab is kept
 * in the URL (?tab=log) without a round trip, so links such as Needs attention's land on the right one.
 */
export function AgentsTabs({ initial, panels }: { initial: AgentTab; panels: Record<AgentTab, ReactNode> }) {
  const [tab, setTab] = useState<AgentTab>(initial)
  return (
    <Tabs
      value={tab}
      onValueChange={v => {
        setTab(v as AgentTab)
        const url = new URL(window.location.href)
        url.searchParams.set('tab', v)
        url.hash = ''
        window.history.replaceState(window.history.state, '', url)
      }}
    >
      <TabsList>
        {AGENT_TABS.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
      </TabsList>
      {AGENT_TABS.map(t => (
        <TabsContent key={t.id} value={t.id} className="space-y-6 mt-4">{panels[t.id]}</TabsContent>
      ))}
    </Tabs>
  )
}
