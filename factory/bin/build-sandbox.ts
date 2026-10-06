/** Build (or confirm) the sandbox worker + egress images for the current factory/docker files. */
import { loadConfig } from '../lib/config'
import { dockerAvailable, ensureSandboxImages } from '../lib/sandbox'

async function main() {
  if (!(await dockerAvailable())) throw new Error('Docker is not running')
  const images = await ensureSandboxImages(loadConfig().sandbox, m => console.log(m))
  console.log(`sandbox images ready: ${images.worker} ${images.egress}`)
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
