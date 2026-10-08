import { describe, it, expect } from 'vitest'
import { plainText } from '../../src/lib/ai/plain-text'

describe('plainText', () => {
  it('drops the heading the model added to the quarterly report', () => {
    expect(plainText('# Q3 2026 Portfolio Commentary\nDavid maintains 60 public repositories.'))
      .toBe('David maintains 60 public repositories.')
  })
  it('removes bold, italics, inline code and bullets but keeps the words', () => {
    expect(plainText('- **Strong** quarter with _steady_ work on `RepoHQ`.\n- Next: tests.'))
      .toBe('Strong quarter with steady work on RepoHQ. Next: tests.')
  })
  it('leaves snake_case and arithmetic alone', () => {
    expect(plainText('Renamed agent_jobs; 2 * 3 = 6.')).toBe('Renamed agent_jobs; 2 * 3 = 6.')
  })
})
