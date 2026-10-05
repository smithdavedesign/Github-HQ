/**
 * Pure helpers for the factory-managed section of ~/ai-stack/litellm/config.yaml.
 *
 * The factory owns two marker-delimited blocks (models + fallbacks) and never
 * touches anything outside them, so hand-maintained entries and comments survive.
 */

export interface ManagedModel {
  /** LiteLLM alias, e.g. free-agent. */
  name: string
  /** Provider model id: an OpenRouter slug or an Ollama tag. */
  model: string
  kind: 'openrouter' | 'ollama'
  numCtx?: number
}

const MODELS_START = '  # >>> repohq-factory models (managed by RepoHQ factory/scout.ts — edit via the scout, not by hand)'
const MODELS_END = '  # <<< repohq-factory models'
const FALLBACKS_START = '    # >>> repohq-factory fallbacks (free-only — the factory decides when to pay)'
const FALLBACKS_END = '    # <<< repohq-factory fallbacks'

export function renderModelsBlock(models: ManagedModel[]): string {
  const entries = models.map(m => {
    const params = m.kind === 'openrouter'
      ? [`      model: openrouter/${m.model}`, '      api_key: os.environ/OPENROUTER_API_KEY']
      : [`      model: ollama_chat/${m.model}`, '      api_base: http://host.docker.internal:11434', `      num_ctx: ${m.numCtx ?? 16384}`]
    return [`  - model_name: ${m.name}`, '    litellm_params:', ...params].join('\n')
  })
  return [MODELS_START, ...entries, MODELS_END].join('\n')
}

export function renderFallbacksBlock(fallbacks: Record<string, string[]>): string {
  const lines = Object.entries(fallbacks)
    .filter(([, to]) => to.length > 0)
    .map(([from, to]) => `    - ${from}: [${to.map(t => JSON.stringify(t)).join(', ')}]`)
  return [FALLBACKS_START, ...lines, FALLBACKS_END].join('\n')
}

function replaceOrInsert(text: string, start: string, end: string, block: string, insertAt: (t: string) => number, label: string): string {
  const s = text.indexOf(start)
  const e = text.indexOf(end)
  if (s !== -1 && e !== -1 && e > s) {
    return text.slice(0, s) + block + text.slice(e + end.length)
  }
  const idx = insertAt(text)
  if (idx < 0) throw new Error(`litellm config: cannot find insertion point for ${label}`)
  return text.slice(0, idx) + block + '\n' + text.slice(idx)
}

/** Index of the start of the line matching `re`, or -1. */
const lineStart = (re: RegExp) => (t: string) => re.exec(t)?.index ?? -1
/** Index just after the line matching `re`, or -1. */
const afterLine = (re: RegExp) => (t: string) => { const m = re.exec(t); return m ? m.index + m[0].length : -1 }

/** Splice both managed blocks into the config text (idempotent). */
export function applyManagedBlocks(text: string, models: ManagedModel[], fallbacks: Record<string, string[]>): string {
  // Models go at the end of model_list (just before litellm_settings:).
  const withModels = replaceOrInsert(text, MODELS_START, MODELS_END, renderModelsBlock(models), lineStart(/^litellm_settings:/m), 'models')
  // Fallbacks go first under router_settings.fallbacks.
  return replaceOrInsert(withModels, FALLBACKS_START, FALLBACKS_END, renderFallbacksBlock(fallbacks), afterLine(/^  fallbacks:\n/m), 'fallbacks')
}

/** alias → provider model currently in the managed block (for reporting). */
export function readManagedModels(text: string): Record<string, string> {
  const s = text.indexOf(MODELS_START)
  const e = text.indexOf(MODELS_END)
  if (s === -1 || e === -1) return {}
  const block = text.slice(s, e)
  const out: Record<string, string> = {}
  const re = /- model_name: (\S+)\n\s+litellm_params:\n\s+model: (?:openrouter|ollama_chat)\/(\S+)/g
  for (let m = re.exec(block); m; m = re.exec(block)) out[m[1]] = m[2]
  return out
}
