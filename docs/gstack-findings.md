# gstack Findings Log

Running record of findings from gstack integration tests and slash commands against the RepoHQ codebase.

Scripts live in `tests/integration/`. Run from the project root:
```bash
bash tests/integration/gstack-security-check.sh          # /investigate — security
bash tests/integration/gstack-health-check.sh            # /health — code quality
GSTACK_SECURITY_PROVIDER=copilot bash tests/integration/gstack-security-check.sh
```

JSON output is written to `.nexus/` and validated against the Nexus agent contract.

---

## 2026-06-02 — `/health` Code Quality Check

**Script:** `tests/integration/gstack-health-check.sh`
**Provider:** Claude Code (claude-sonnet-4-6)
**Score:** 76 / 100
**Outcome:** `no-changes` (assessment only)

### ✅ Passing

| Check | Detail |
|-------|--------|
| TypeScript | 0 errors (`npm run typecheck` clean) |
| Unit tests | 423/423 passing across 29 test files |
| `'use server'` correctness | All non-async exports are type/interface exports — no illegal non-async function exports |
| N+1 queries | None detected — all loops iterate over in-memory data fetched before the loop |

### ⚠️ Findings

**Test coverage gaps** — 7 of 15 server action files have zero unit tests:

| File | Untested Exports |
|------|-----------------|
| `src/lib/actions/repositories.ts` | 33 functions (largest gap) |
| `src/lib/actions/goals.ts` | 6 functions |
| `src/lib/actions/stripe.ts` | 7 functions |
| `src/lib/actions/llm.ts` | 4 functions |
| `src/lib/actions/changelog.ts` | 3 functions |
| `src/lib/actions/auto-dispatch-settings.ts` | 2 functions |
| `src/lib/actions/weekly-diff.ts` | 1 function |

**Error handling** — Server actions with no try/catch:

| File | Risk |
|------|------|
| `src/lib/actions/repositories.ts` | **33 async functions, 0 try/catch.** DB failures propagate as unhandled errors to the client. Highest priority. |
| `src/lib/actions/changelog.ts` | 0–1 try/catch for DB-touching functions |
| `src/lib/actions/auto-dispatch-settings.ts` | 0–1 try/catch |
| `src/lib/github/sync.ts` | 0–1 try/catch on some paths |

**`any` types:**

| Location | Detail |
|----------|--------|
| `src/lib/actions/advisor-accuracy.ts:29` | `let mergedEvents: any[]` — should be typed as the Drizzle partial row type |
| `src/lib/github/sync.ts:109` | `githubRepo: any` parameter — GitHub REST API response type; intentional but undocumented |

### Recommended Actions

1. **Highest priority:** Add try/catch to `repositories.ts` — wrap DB calls to return structured errors instead of raw exceptions
2. Add unit tests to `goals.ts`, `stripe.ts`, `llm.ts` (pure validation logic is easy to test without DB)
3. Type `mergedEvents` in `advisor-accuracy.ts` using Drizzle's inferred partial type

---

## 2026-06-02 — `/investigate` Security Check

**Script:** `tests/integration/gstack-security-check.sh`
**Provider:** Claude Code / GitHub Copilot
**Outcome:** Rate limited — both providers exhausted before completing

**Status:** Both Claude and Copilot hit rate limits during this run. The script infrastructure, provider routing, and contract validation all worked correctly. Re-run when limits reset.

**To re-run:**
```bash
bash tests/integration/gstack-security-check.sh                    # Claude
GSTACK_SECURITY_PROVIDER=copilot bash tests/integration/gstack-security-check.sh  # Copilot
```

---

## Log Format

Each entry should follow this structure:

```
## YYYY-MM-DD — /[command] [description]

**Script:** tests/integration/gstack-[name].sh
**Provider:** Claude Code | GitHub Copilot | Codex
**Score:** N / 100  (if applicable)
**Outcome:** no-changes | changes-made | blocked | rate-limited

### ✅ Passing
...

### ⚠️ Findings
...

### Recommended Actions
...
```
