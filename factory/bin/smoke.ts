/**
 * Preview smoke test by hand (lib/smoke.ts; skill: preview-smoke).
 *   npm run factory:smoke -- <pr-url> [--paths /,/pricing] [--comment]
 *   npm run factory:smoke -- --repo owner/name --sha <commit> [--paths /]   # a commit's preview vs production
 * Prints the result as JSON. --comment posts it on the PR (and labels smoke:fail on failure).
 */
import { loadConfig } from '../lib/config'
import { addPrLabel } from '../lib/git'
import { commentOnPr } from '../lib/local-review'
import { SMOKE_FAIL_LABEL, bypassSecret, compareSmoke, deploymentUrl, smokeComment, smokePr, visit } from '../lib/smoke'

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

async function main() {
  const cfg = loadConfig()
  const prUrl = args.find(a => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(a))
  const repoFlag = flag('--repo')
  const repo = repoFlag ?? prUrl?.match(/github\.com\/([^/]+\/[^/]+)\/pull/)?.[1]
  if (!repo) throw new Error('usage: factory:smoke -- <pr-url> | --repo owner/name --sha <commit> [--paths /,/x] [--comment]')
  const paths = (flag('--paths') ?? '').split(',').filter(Boolean)
  const usePaths = paths.length ? paths : cfg.smoke.paths[repo] ?? ['/']
  const sha = flag('--sha')
  if (sha) {
    const preview = await deploymentUrl(repo, sha, /preview/i)
    const production = await deploymentUrl(repo, null, /^production$/i)
    if (!preview.url || !production.url) return console.log(JSON.stringify({ verdict: 'skipped', preview, production }))
    const bypass = await bypassSecret(repo, cfg.home, cfg.smoke.vercelScope)
    const prod = [await visit(production.url, usePaths, bypass), await visit(production.url, usePaths, bypass)]
    const pv = [await visit(preview.url, usePaths, bypass), await visit(preview.url, usePaths, bypass)]
    return console.log(JSON.stringify({ ...compareSmoke(prod, pv), previewUrl: preview.url, productionUrl: production.url, production: prod[0], preview: pv[0] }, null, 1))
  }
  const result = await smokePr({ repo, prUrl: prUrl!, attemptId: 'manual', home: cfg.home, paths: usePaths, vercelScope: cfg.smoke.vercelScope })
  console.log(JSON.stringify(result, null, 1))
  if (args.includes('--comment') && result.verdict !== 'skipped') {
    await commentOnPr(prUrl!, smokeComment(result))
    if (result.verdict === 'fail') await addPrLabel(prUrl!, repo, SMOKE_FAIL_LABEL, 'RepoHQ factory: the preview breaks pages that work on production')
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
