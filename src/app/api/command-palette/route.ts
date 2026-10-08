import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()
    const result = await interpretCommand(query)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Command processing failed' }, { status: 500 })
  }
}

async function interpretCommand(query: string) {
  const commandMap: Record<string, () => string> = {
    'health': () => 'Running health check...',
    'repo-status': () => 'Checking repo status...',
    'agent-status': () => 'Checking agent status...',
    'notion-ideas': () => 'Loading Notion ideas...',
    'generate-report': () => 'Generating report...',
    'dispatch-agent': () => 'Dispatching agent...',
    'deploy': () => 'Deploying...'
  }

  const lowerQuery = query.toLowerCase()
  for (const [keyword, action] of Object.entries(commandMap)) {
    if (lowerQuery.includes(keyword)) {
      return action()
    }
  }
  return 'Unknown command. Try: health check, repo status, agent status, notion ideas, generate report, dispatch agent, or deploy.'
}
