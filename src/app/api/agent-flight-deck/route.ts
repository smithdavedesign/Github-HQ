import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const activeAgents = [
      {
        id: 'agent-001',
        type: 'Nexus',
        status: 'active',
        progress: 73,
        startedAt: new Date(Date.now() - 5 * 60000).toISOString(),
        description: 'Analyzing repository health and generating insights',
        currentTask: 'Repository health assessment',
      },
      {
        id: 'agent-002',
        type: 'Gstack',
        status: 'completed',
        progress: 100,
        startedAt: new Date(Date.now() - 15 * 60000).toISOString(),
        description: 'Gstack agent processing PM, CEO, and Product Manager ideas from Notion',
      }
    ]
    return NextResponse.json({ success: true, activeAgents })
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch agent data' }, { status: 500 })
  }
}
