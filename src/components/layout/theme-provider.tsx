'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && systemDark)
  root.classList.toggle('dark', isDark)
  root.classList.toggle('light', !isDark)
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system')

  useEffect(() => {
    const stored = (localStorage.getItem('theme') as Theme) ?? 'system'
    setThemeState(stored)
    applyTheme(stored)
  }, [])

  function setTheme(next: Theme) {
    setThemeState(next)
    localStorage.setItem('theme', next)
    applyTheme(next)
  }

  return { theme, setTheme }
}
