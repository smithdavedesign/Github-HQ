/**
 * Pure helpers for the factory-managed section of ~/ai-stack/litellm/config.yaml.
 *
 * The factory owns two marker-delimited blocks (models + fallbacks) and never
 * touches anything outside them, so hand-maintained entries and comments survive.
 */

/**
 * Providers a pool member can come from. Free tiers on three independent
 * providers mean one provider's quota (e.g. OpenRouter's 50/day) never stops the agent.
 */
export type ProviderKind = 'gemini' | 'ollama-cloud' | 'openrouter' | 'ollama'

export interface ManagedModel {
  /** LiteLLM alias, e.g. free-agent. */
  name: string
  /** Provider model id: Gemini model, Ollama Cloud tag, OpenRouter slug, or local Ollama tag. */
  model: string
  kind: ProviderKind
  numCtx?: number
}

/** "gemini:gemini-2.5-flash", "ollama-cloud:gpt-oss:120b", "openrouter:cohere/north-mini-code:free". */
export type PoolId = string

export function poolId(kind: ProviderKind, model: string): PoolId {
  return `${kind}:${model}`
}

const KINDS: ProviderKind[] = ['gemini', 'ollama-cloud', 'openrouter', 'ollama']

export function parsePoolId(id: PoolId): { kind: ProviderKind; model: string } {
  const kind = KINDS.find(k => id.startsWith(`${k}:`))
  // Bare ids predate the pool and were always OpenRouter slugs.
  return kind ? { kind, model: id.slice(kind.length + 1) } : { kind: 'openrouter', model: id }
}

export function memberFor(name: string, id: PoolId): ManagedModel {
  return { name, ...parsePoolId(id) }
}

export const OLLAMA_CLOUD_BASE = 'https://ollama.com/v1'

const MODELS_START = '  # >>> repohq-factory models (managed by RepoHQ factory/scout.ts — edit via the scout, not by hand)'
const MODELS_END = '  # <<< repohq-factory models'
const FALLBACKS_START = '    # >>> repohq-factory fallbacks (pool ladders; only local-coder ends at paid cloud-smart — see factory/scout.ts)'
const FALLBACKS_END = '    # <<< repohq-factory fallbacks'

export function renderModelsBlock(models: ManagedModel[]): string {
  const entries = models.map(m => {
    const params = {
      'openrouter': [`      model: openrouter/${m.model}`, '      api_key: os.environ/OPENROUTER_API_KEY'],
      'gemini': [`      model: gemini/${m.model}`, '      api_key: os.environ/GEMINI_API_KEY'],
      // Ollama Cloud's OpenAI-compatible endpoint (supports tool calls).
      'ollama-cloud': [`      model: openai/${m.model}`, `      api_base: ${OLLAMA_CLOUD_BASE}`, '      api_key: os.environ/OLLAMA_API_KEY'],
      'ollama': [`      model: ollama_chat/${m.model}`, '      api_base: http://host.docker.internal:11434', `      num_ctx: ${m.numCtx ?? 16384}`],
    }[m.kind]
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

/** Header lines may be reworded between versions; blocks are found by their stable marker prefix. */
function markerIndex(text: string, marker: string): number {
  const prefix = marker.trim().split(' (')[0]
  const m = new RegExp(`^[ \\t]*${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'm').exec(text)
  return m ? m.index : -1
}

function replaceOrInsert(text: string, start: string, end: string, block: string, insertAt: (t: string) => number, label: string): string {
  const s = markerIndex(text, start)
  const e = text.indexOf(end, Math.max(s, 0))
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

/** alias → pool id currently in the managed block. */
export function readManagedModels(text: string): Record<string, PoolId> {
  const s = markerIndex(text, MODELS_START)
  const e = text.indexOf(MODELS_END)
  if (s === -1 || e === -1) return {}
  const out: Record<string, PoolId> = {}
  for (const entry of text.slice(s, e).split(/\n(?=  - model_name: )/)) {
    const name = /- model_name: (\S+)/.exec(entry)?.[1]
    const model = /\n\s+model: (\S+)/.exec(entry)?.[1]
    if (!name || !model) continue
    const [prefix, ...rest] = model.split('/')
    const id = rest.join('/')
    if (prefix === 'openrouter') out[name] = poolId('openrouter', id)
    else if (prefix === 'gemini') out[name] = poolId('gemini', id)
    else if (prefix === 'openai' && entry.includes(OLLAMA_CLOUD_BASE)) out[name] = poolId('ollama-cloud', id)
    else if (prefix === 'ollama_chat') out[name] = poolId('ollama', id)
  }
  return out
}
