/**
 * Live check of the sandbox boundary (needs Docker; LiteLLM optional). Prints one line per
 * property and exits non-zero if any isolation property fails.
 *   npx tsx factory/eval/sandbox-smoke.ts [path/to/repo]
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_SANDBOX } from '../lib/config'
import { run } from '../lib/proc'
import { Sandbox, dockerAvailable, ensureSandboxImages } from '../lib/sandbox'

async function main() {
  if (!(await dockerAvailable())) throw new Error('Docker is not running')
  const tmp = mkdtempSync(path.join(tmpdir(), 'sbx-smoke-'))
  const repo = process.argv[2] ?? path.join(tmp, 'repo')
  if (!process.argv[2]) {
    mkdirSync(repo)
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', scripts: { test: "node -e \"process.exit(require('left-pad')('a',3)==='  a'?0:1)\"" }, dependencies: { 'left-pad': '1.3.0' } }))
    writeFileSync(path.join(repo, 'README.md'), '# fx\n')
    for (const a of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init']]) await run('git', ['-C', repo, ...a])
  }
  process.env.SANDBOX_SMOKE_SECRET = 'host-secret-value'
  const images = await ensureSandboxImages(DEFAULT_SANDBOX, m => console.log(m))
  const sb = await Sandbox.open({ cfg: DEFAULT_SANDBOX, litellmUrl: 'http://localhost:4000', litellmKey: process.env.FACTORY_LITELLM_KEY ?? '', allowModels: ['local-agent'], scope: tmp, images })
  let failed = 0
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }
  try {
    await sb.copyIn(repo)
    const sh = (c: string, timeoutMs = 60_000) => sb.run('sh', ['-c', c], { timeoutMs })
    check('repo copied in (with .git)', (await sh('test -f package.json && git rev-parse HEAD')).code === 0)
    check('runs as non-root', (await sh('id -u')).output.trim() !== '0')
    check('host env not inherited', !(await sh('env')).output.includes('host-secret-value'))
    check('no GitHub credential', (await sh('test -z "$GH_TOKEN$GITHUB_TOKEN" && ! command -v gh && test ! -e ~/.config/gh')).code === 0)
    check('no host home / Docker socket', (await sh('test ! -e /Users && test ! -e /var/run/docker.sock')).code === 0)
    check('no direct internet', (await sh('node -e "fetch(\'https://example.com\').then(()=>process.exit(0),()=>process.exit(1))"', 30_000)).code !== 0)
    check('proxy refuses other hosts', (await sh('node -e "require(\'https\')" && npm view --registry=https://example.com left-pad version', 60_000)).code !== 0)
    const install = await sb.run('npm', ['install', '--no-audit', '--no-fund'], { timeoutMs: 180_000 })
    check('npm install via registry allowlist', install.code === 0, install.code === 0 ? '' : install.output.slice(-300))
    check('repo tests run inside', (await sb.run('npm', ['test'], { timeoutMs: 60_000 })).code === 0)
    check('in-container timeout kills overruns', (await sb.run('sleep', ['30'], { timeoutMs: 2_000 })).timedOut)
    const relay = await sh(`node -e "fetch('${sb.litellmUrl}/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer sk-repohq-sandbox'},body:JSON.stringify({model:'cloud-smart',messages:[{role:'user',content:'hi'}]})}).then(r=>process.exit(r.status===403?0:1),()=>process.exit(2))"`)
    check('relay refuses the paid alias', relay.code === 0)
    await sh('echo "More docs." >> README.md && git add -A && git commit -qm change')
    const base = (await sh('git rev-parse HEAD~1')).output.trim()
    const patch = path.join(tmp, 'out.patch')
    await sb.exportPatch(base, patch)
    const apply = await run('git', ['-C', repo, 'apply', '--check', patch])
    check('patch exported and applies on host', apply.code === 0, apply.output.slice(-200))
  } finally {
    await sb.close()
    const left = (await run('docker', ['ps', '-aq', '--filter', `name=${sb.names.worker}`])).output.trim()
    check('container removed after the job', left === '')
    rmSync(tmp, { recursive: true, force: true })
  }
  if (failed > 0) { console.error(`${failed} check(s) failed`); process.exit(1) }
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
