// Model relay: worker → LiteLLM, allowing only EGRESS_ALLOW_MODELS. GET requests (health,
// model lists) pass; every POST must name an allowed model in its JSON body.
import http from 'node:http'

const upstream = new URL(process.env.LITELLM_UPSTREAM ?? 'http://host.docker.internal:4000')
const allowed = new Set((process.env.EGRESS_ALLOW_MODELS ?? '').split(/[\s,]+/).filter(Boolean))
const MAX_BODY = 32 * 1024 * 1024

function deny(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `repohq sandbox relay: ${message}`, type: 'sandbox_policy' } }))
}

http.createServer((req, res) => {
  const chunks = []
  let size = 0
  req.on('data', c => {
    size += c.length
    if (size > MAX_BODY) { deny(res, 413, 'request too large'); req.destroy() } else chunks.push(c)
  })
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      let model = null
      try { model = JSON.parse(body.toString('utf8')).model ?? null } catch { /* not JSON */ }
      if (typeof model !== 'string' || !allowed.has(model)) {
        console.log(`denied ${req.method} ${req.url} model=${model}`)
        return deny(res, 403, `model ${JSON.stringify(model)} is not allowed in the sandbox`)
      }
    }
    const headers = { ...req.headers, host: upstream.host, 'content-length': String(body.length) }
    const up = http.request({ hostname: upstream.hostname, port: upstream.port || 80, path: req.url, method: req.method, headers }, r => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    up.on('error', err => deny(res, 502, `upstream error: ${err.message}`))
    up.end(body)
  })
}).listen(4000, '0.0.0.0', () => console.log(`relay → ${upstream.href} models=${[...allowed].join(',')}`))
