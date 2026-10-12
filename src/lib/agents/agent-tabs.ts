/** The Agents page's tabs (it was one 9,000 px column). Shared by the server page and the client tabs. */
export const AGENT_TABS = [
  { id: 'now', label: 'Now' },
  { id: 'runs', label: 'Runs' },
  { id: 'requests', label: 'Requests' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'log', label: 'Log' },
] as const

export type AgentTab = (typeof AGENT_TABS)[number]['id']

/** ?tab= from the URL, or "now". */
export function parseAgentTab(value: string | string[] | undefined): AgentTab {
  const v = Array.isArray(value) ? value[0] : value
  return AGENT_TABS.some(t => t.id === v) ? (v as AgentTab) : 'now'
}
