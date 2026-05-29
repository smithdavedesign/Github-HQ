interface CheckResult {
  status: 'healthy' | 'slow' | 'down'
  responseTimeMs: number | null
  httpStatus: number | null
  sslValid: boolean | null
}

export async function checkDeploymentUrl(url: string): Promise<CheckResult> {
  const start = Date.now()

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })

    const responseTimeMs = Date.now() - start
    const sslValid = url.startsWith('https://')

    let status: 'healthy' | 'slow' | 'down'
    if (!response.ok) {
      status = 'down'
    } else if (responseTimeMs > 3000) {
      status = 'slow'
    } else {
      status = 'healthy'
    }

    return {
      status,
      responseTimeMs,
      httpStatus: response.status,
      sslValid,
    }
  } catch {
    return {
      status: 'down',
      responseTimeMs: null,
      httpStatus: null,
      sslValid: null,
    }
  }
}

export async function checkAllDeployments(deploymentList: { id: number; url: string }[]): Promise<
  Array<{ id: number } & CheckResult>
> {
  const results = await Promise.allSettled(
    deploymentList.map(async (d) => {
      const result = await checkDeploymentUrl(d.url)
      return { id: d.id, ...result }
    }),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<{ id: number } & CheckResult> => r.status === 'fulfilled')
    .map((r) => r.value)
}
