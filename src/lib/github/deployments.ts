import type { OctokitClient } from './client'

export interface DiscoveredDeployment {
  url: string
  name: string
  provider: string
}

/**
 * Auto-discovers deployment URLs for a repo using:
 * 1. GitHub Environments (has deployment URL)
 * 2. GitHub Pages settings
 * 3. Vercel/Netlify/Render pattern matching on env names
 */
export async function discoverDeployments(
  octokit: OctokitClient,
  owner: string,
  repo: string,
): Promise<DiscoveredDeployment[]> {
  const found: DiscoveredDeployment[] = []
  const seen = new Set<string>()

  const add = (url: string, name: string, provider: string) => {
    const clean = url.trim().replace(/\/$/, '')
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    found.push({ url: clean, name, provider })
  }

  // 1. GitHub Environments — often contain deployment URLs
  try {
    const { data: envs } = await octokit.rest.repos.getAllEnvironments({ owner, repo })
    for (const env of envs.environments ?? []) {
      // Fetch the latest deployment for this environment
      const deployments = await octokit.rest.repos.listDeployments({
        owner,
        repo,
        environment: env.name,
        per_page: 1,
      })
      if (deployments.data.length === 0) continue

      const depId = deployments.data[0].id
      const statuses = await octokit.rest.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: depId,
        per_page: 1,
      })

      const url = statuses.data[0]?.environment_url ?? statuses.data[0]?.log_url
      if (url && url.startsWith('http')) {
        const provider = detectProviderFromUrl(url, env.name)
        add(url, env.name, provider)
      }
    }
  } catch {
    // Environments not available (e.g. private repo without access)
  }

  // 2. GitHub Pages
  try {
    const { data: pages } = await octokit.rest.repos.getPages({ owner, repo })
    if (pages.html_url) {
      add(pages.html_url, 'GitHub Pages', 'github-pages')
    }
  } catch {
    // Pages not enabled — expected for most repos
  }

  // 3. Detect from homepage field (already stored on repo)
  return found
}

function detectProviderFromUrl(url: string, envName: string): string {
  const lower = url.toLowerCase()
  const name = envName.toLowerCase()
  if (lower.includes('vercel.app') || lower.includes('vercel.com') || name.includes('vercel')) return 'vercel'
  if (lower.includes('netlify.app') || lower.includes('netlify.com') || name.includes('netlify')) return 'netlify'
  if (lower.includes('onrender.com') || name.includes('render')) return 'render'
  if (lower.includes('railway.app') || name.includes('railway')) return 'railway'
  if (lower.includes('fly.dev') || name.includes('fly')) return 'fly'
  if (lower.includes('github.io')) return 'github-pages'
  if (lower.includes('azurewebsites.net') || lower.includes('azure')) return 'azure'
  if (lower.includes('amazonaws.com') || lower.includes('aws')) return 'aws'
  if (name.includes('production') || name.includes('prod')) return 'custom'
  return 'custom'
}
