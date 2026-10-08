import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const ideas = [
      {
        id: 'notion-001',
        title: 'Implement AI-powered content recommendations',
        status: 'in-progress',
        priority: 'high',
        source: 'product-manager',
      },
      {
        id: 'notion-002',
        title: 'Review and optimize CI/CD pipeline',
        status: 'review',
        priority: 'medium',
        source: 'ceo',
      },
      {
        id: 'notion-003',
        title: 'Design new user onboarding flow',
        status: 'todo',
        priority: 'high',
        source: 'project-manager',
      }
    ]
    return NextResponse.json({ success: true, ideas })
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch Notion ideas' }, { status: 500 })
  }
}
