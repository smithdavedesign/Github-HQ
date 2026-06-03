# Security Investigation: RepoHQ Codebase

You are a security-focused software engineer reviewing the RepoHQ Next.js application.

## Scope
Investigate the following areas for security vulnerabilities:
1. Authentication & session handling (src/lib/auth.ts, src/proxy.ts)
2. Server action authorization (src/lib/actions/*.ts) — do all actions verify auth?
3. API route guards (src/app/api/) — are cron + webhook endpoints properly protected?
4. SQL injection risks (raw SQL usage, Drizzle ORM consistency)
5. Secret handling (env vars, no hardcoded keys in code)
6. Input validation (URL validation, user-supplied data sanitization)

## Rules
- Read the actual source files before making any claims
- Only report genuine findings, not theoretical risks without code evidence
- Do NOT make any code changes — this is investigation only

## Output
After investigating, write a JSON file to the path specified in NEXUS_AGENT_OUTPUT_FILE with this exact structure:
{
  "contractVersion": "nexus-agent-output-v1",
  "summary": "One sentence: overall security posture and top finding",
  "findings": [
    "Finding 1: specific issue with file path and line reference",
    "Finding 2: ...",
    "No critical vulnerabilities found (if clean)"
  ],
  "outcome": "no-changes",
  "changedFiles": [],
  "validationCommand": "npm run typecheck",
  "securityScore": 0-100
}
