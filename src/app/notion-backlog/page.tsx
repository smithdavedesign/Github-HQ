"use client"

import { useState, useEffect } from 'react'

export default function NotionBacklogBoard() {
  const [ideas, setIdeas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notion-ideas')
      .then(res => res.json())
      .then(data => {
        if (data.success) setIdeas(data.ideas)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8">Loading Notion ideas board...</div>

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Interactive Notion Backlog Board</h1>
      <div className="grid grid-cols-3 gap-4">
        {ideas.map(idea => (
          <div key={idea.id} className="p-4 border rounded shadow-sm bg-white">
            <span className="text-xs font-semibold uppercase px-2 py-1 bg-gray-100 rounded text-gray-600">{idea.source}</span>
            <h2 className="font-semibold text-lg mt-2">{idea.title}</h2>
            <div className="mt-4 flex justify-between items-center text-sm">
              <span className="capitalize text-blue-600 font-medium">{idea.status}</span>
              <span className="uppercase text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 font-bold">{idea.priority}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
