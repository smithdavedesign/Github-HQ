# Code Health Assessment: RepoHQ Codebase

You are a senior TypeScript engineer reviewing the RepoHQ Next.js codebase for code quality.

## Checklist
1. TypeScript strictness — are there any `any` types that should be typed? (run: npx tsc --noEmit)
2. Error handling — are server actions wrapped in try/catch? Do they handle DB failures gracefully?
3. Dead code — exported functions that are never imported?
4. Test coverage gaps — which areas of src/lib/actions/ have no tests?
5. Performance — any obvious N+1 queries or missing async parallelism?
6. 'use server' correctness — any non-async exports from 'use server' files?

## Rules
- Run `npm test` and `npm run typecheck` to get actual output
- Only report real issues with file paths, not hypotheticals
- No code changes — assessment only

## Output
Write JSON to NEXUS_AGENT_OUTPUT_FILE:
{
  "contractVersion": "nexus-agent-output-v1",
  "summary": "One sentence health summary",
  "findings": [
    "✅ TypeScript: 0 errors",
    "⚠️ Coverage gap: src/lib/actions/nexus.ts has no unit tests",
    "..."
  ],
  "outcome": "no-changes",
  "changedFiles": [],
  "validationCommand": "npm test && npm run typecheck",
  "healthScore": 0-100
}
