---
name: preview-smoke
description: |
  Smoke-test a pull request's Vercel preview in a real browser, next to production: HTTP status,
  page crashes and console errors (hydration errors included) on the app's public pages. Catches
  what typecheck, lint, tests and build can't, because it runs the app. Use when asked to "smoke
  test", "check the preview", "verify this PR runs", "does the preview work", before merging a PR on
  a Vercel-hosted repo, or after the factory opens a PR. Companion to gstack /qa (deep, interactive
  QA of a site) and /canary (watching production after a deploy). The RepoHQ factory runs this
  automatically on every open factory PR and comments the result.
---

# Preview smoke

The factory runs this on every open factory PR in its reconcile step (`factory/lib/smoke.ts`) and
comments **Preview smoke: pass / fail / skipped**. A failure adds the `smoke:fail` label. Use this
skill to run it by hand.

## Run

From the RepoHQ checkout (or the factory's deployed copy at `~/.repohq-factory/app`):

```bash
npm run factory:smoke -- <pr-url>                       # the PR's preview vs production
npm run factory:smoke -- <pr-url> --paths /,/pricing    # choose public paths (default: config, else "/")
npm run factory:smoke -- <pr-url> --comment             # also post the result on the PR
npm run factory:smoke -- --repo owner/name --sha <commit>   # any commit's preview vs production
```

Per-repo paths live in `factory/factory.config.json` → `smoke.paths`.

## What the verdict means

- **fail:** a public page that works on production doesn't on the preview. That means a 4xx/5xx,
  a page crash, or an error that shows on every preview load and on no production load. Read the
  reasons, open the preview URL, and fix before merging.
- **pass:** the listed pages load like production.
- **skipped:** no Vercel preview for the commit, no production deployment to compare with, or the
  pages were protected and no bypass was available. It says which.

Each side is loaded twice, and known third-party chatter (Google sign-in/FedCM, extensions) is
ignored, so flaky noise doesn't fail a PR.

## Limits

- Pages behind a login aren't checked; no credentials are used. For logged-in flows, use gstack `/qa`
  with imported cookies.
- Vercel deployment protection is passed with the project's "Protection Bypass for Automation"
  secret, created once and cached in `~/.repohq-factory/vercel-bypass.json` (mode 600).
