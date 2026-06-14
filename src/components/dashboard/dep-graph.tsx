'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GitFork, Info } from 'lucide-react'

export interface DepNode {
  id: number
  name: string
  health: number
}

export interface DepEdge {
  source: number  // repoId that depends on target (or either side for 'external')
  target: number  // repoId being depended on (or either side for 'external')
  /** 'internal' (default): one portfolio repo depends on another. 'external': repos share a prominent third-party dep. */
  type?: 'internal' | 'external'
  /** For 'external' edges: comma-joined names of the shared dependencies. */
  label?: string
}

interface Props {
  nodes: DepNode[]
  edges: DepEdge[]
}

const W = 640
const H = 400
const NODE_R = 13

function runForceLayout(
  nodes: DepNode[],
  edges: DepEdge[],
): { x: number; y: number }[] {
  if (nodes.length === 0) return []

  // Initial circular positions
  const pos = nodes.map((_, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI
    return { x: W / 2 + Math.cos(angle) * W * 0.32, y: H / 2 + Math.sin(angle) * H * 0.36 }
  })

  const vel = nodes.map(() => ({ x: 0, y: 0 }))
  const idxById = new Map(nodes.map((n, i) => [n.id, i]))

  const ITERS = 180
  const REPULSION = 1800
  const SPRING_K = 0.08
  const IDEAL_LEN = 140
  const CENTER_K = 0.012
  const DAMPING = 0.80

  for (let iter = 0; iter < ITERS; iter++) {
    const forces = nodes.map(() => ({ x: 0, y: 0 }))

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = pos[i].x - pos[j].x
        const dy = pos[i].y - pos[j].y
        const d2 = dx * dx + dy * dy || 0.001
        const d = Math.sqrt(d2)
        const f = REPULSION / d2
        forces[i].x += f * dx / d
        forces[i].y += f * dy / d
        forces[j].x -= f * dx / d
        forces[j].y -= f * dy / d
      }
    }

    // Spring along edges
    for (const e of edges) {
      const si = idxById.get(e.source) ?? -1
      const ti = idxById.get(e.target) ?? -1
      if (si < 0 || ti < 0) continue
      const dx = pos[ti].x - pos[si].x
      const dy = pos[ti].y - pos[si].y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001
      const f = SPRING_K * (d - IDEAL_LEN)
      forces[si].x += f * dx / d
      forces[si].y += f * dy / d
      forces[ti].x -= f * dx / d
      forces[ti].y -= f * dy / d
    }

    // Centering
    for (let i = 0; i < nodes.length; i++) {
      forces[i].x += (W / 2 - pos[i].x) * CENTER_K
      forces[i].y += (H / 2 - pos[i].y) * CENTER_K
    }

    // Integrate
    for (let i = 0; i < nodes.length; i++) {
      vel[i].x = (vel[i].x + forces[i].x) * DAMPING
      vel[i].y = (vel[i].y + forces[i].y) * DAMPING
      pos[i].x = Math.max(NODE_R + 40, Math.min(W - NODE_R - 40, pos[i].x + vel[i].x))
      pos[i].y = Math.max(NODE_R + 24, Math.min(H - NODE_R - 24, pos[i].y + vel[i].y))
    }
  }

  return pos
}

function healthColor(score: number): string {
  if (score >= 75) return '#22c55e'
  if (score >= 55) return '#f59e0b'
  return '#ef4444'
}

export function DepGraph({ nodes, edges }: Props) {
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const positions = useMemo(() => runForceLayout(nodes, edges), [nodes, edges])
  const idxById = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes])

  const hoveredEdgeSet = useMemo(() => {
    if (hoveredId === null) return new Set<string>()
    return new Set(
      edges
        .filter(e => e.source === hoveredId || e.target === hoveredId)
        .map(e => `${e.source}-${e.target}-${e.type ?? 'internal'}`)
    )
  }, [hoveredId, edges])

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm">
        <GitFork className="w-8 h-8 mb-3 opacity-30" />
        <p className="font-medium">No dependencies detected</p>
        <p className="text-xs mt-1">Edges appear when one portfolio repo uses another as an npm package, or when repos share a prominent third-party dependency</p>
      </div>
    )
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      className="rounded-lg overflow-visible"
      aria-label="Portfolio dependency graph"
    >
      {/* Edges */}
      {edges.map(edge => {
        const si = idxById.get(edge.source) ?? -1
        const ti = idxById.get(edge.target) ?? -1
        if (si < 0 || ti < 0) return null
        const isExternal = edge.type === 'external'
        const key = `${edge.source}-${edge.target}-${edge.type ?? 'internal'}`
        const isHighlighted = hoveredEdgeSet.has(key)
        const dimmed = hoveredId !== null && !isHighlighted

        const x1 = positions[si].x
        const y1 = positions[si].y
        const x2 = positions[ti].x
        const y2 = positions[ti].y
        const angle = Math.atan2(y2 - y1, x2 - x1)

        if (isExternal) {
          // Undirected shared-dependency edge: dashed, no arrowhead, with a label at the midpoint
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2
          return (
            <g key={key} opacity={dimmed ? 0.1 : 1}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isHighlighted ? 'oklch(0.585 0.233 277)' : 'rgba(129,140,248,0.35)'}
                strokeWidth={isHighlighted ? 2 : 1}
                strokeDasharray="4 3"
              />
              {edge.label && (
                <text
                  x={mx} y={my - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="oklch(0.585 0.233 277)"
                  className="fill-indigo-500"
                >
                  {edge.label}
                </text>
              )}
            </g>
          )
        }

        // Internal edge: solid line + arrowhead, direction source → target
        const ex = x2 - Math.cos(angle) * (NODE_R + 3)
        const ey = y2 - Math.sin(angle) * (NODE_R + 3)

        return (
          <g key={key} opacity={dimmed ? 0.1 : 1}>
            <line
              x1={x1} y1={y1} x2={ex} y2={ey}
              stroke={isHighlighted ? 'oklch(0.514 0.222 268)' : 'rgba(148,163,184,0.35)'}
              strokeWidth={isHighlighted ? 2 : 1.5}
              markerEnd="url(#arrowhead)"
            />
          </g>
        )
      })}

      {/* Arrow marker */}
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="rgba(148,163,184,0.6)" />
        </marker>
      </defs>

      {/* Nodes */}
      {nodes.map((node, i) => {
        const { x, y } = positions[i]
        const color = healthColor(node.health)
        const isHovered = hoveredId === node.id
        const isConnected = hoveredId !== null && hoveredEdgeSet.size > 0 && (
          edges.some(e => (e.source === hoveredId && e.target === node.id) || (e.target === hoveredId && e.source === node.id))
        )
        const dimmed = hoveredId !== null && !isHovered && !isConnected

        return (
          <g
            key={node.id}
            onMouseEnter={() => setHoveredId(node.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ cursor: 'default' }}
            opacity={dimmed ? 0.3 : 1}
          >
            <circle
              cx={x} cy={y} r={isHovered ? NODE_R + 2 : NODE_R}
              fill={color + '22'}
              stroke={color}
              strokeWidth={isHovered ? 2.5 : 1.5}
            />
            <text
              x={x} y={y + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fontWeight="600"
              fill={color}
            >
              {node.health}
            </text>
            <text
              x={x} y={y + NODE_R + 11}
              textAnchor="middle"
              fontSize={9.5}
              fill="currentColor"
              className="fill-foreground/70"
            >
              {node.name.length > 14 ? node.name.slice(0, 12) + '…' : node.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function DepGraphCard({ nodes, edges }: Props) {
  const connectedNodeIds = useMemo(() => {
    const ids = new Set<number>()
    for (const e of edges) { ids.add(e.source); ids.add(e.target) }
    return ids
  }, [edges])

  const displayNodes = nodes.filter(n => connectedNodeIds.has(n.id))

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">Dependency Map</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Repos that depend on other repos in your portfolio, and repos that share prominent third-party packages
            </p>
          </div>
          {edges.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Info className="w-3 h-3" />
              <span>Hover to highlight</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <DepGraph nodes={displayNodes} edges={edges} />
        {displayNodes.length > 0 && (
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> ≥90</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> 70–89</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &lt;70</span>
            {edges.some(e => e.type === 'external') && (
              <span className="flex items-center gap-1">
                <span className="w-3 border-t border-dashed border-indigo-400 inline-block" /> Shared dependency
              </span>
            )}
            <span className="ml-auto">{displayNodes.length} repos · {edges.length} dep{edges.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
