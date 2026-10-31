# Hosting

Since 2026-10-31 RepoHQ runs on the owner's Mac, not Vercel. The Vercel team was soft-blocked for build
CPU until 2026-11-30, so https://repohq.vercel.app returned 402. RepoHQ is a personal dashboard: one user, who
opens it on the Mac or on his phone over Tailscale.

## How it runs

The launcher, launchd jobs and runbook live in ai-stack: `~/ai-stack/bin/repohq-web`, README section
*RepoHQ on this Mac*.

- **Checkout:** `~/.repohq-web`, a clone of `main`. It sits outside `~/Documents` because launchd can't read
  that folder. It is not the factory's `~/.repohq-factory/app`, which the factory deploys itself.
- **Server:** a production build (`next build`, then `next start`) on `127.0.0.1:3200`, under launchd
  `com.localai.repohq-web` (KeepAlive).
- **Updates:** launchd `com.localai.repohq-web-update` runs at 03:30. It rebuilds only when `main` moved,
  waits for free memory first and keeps the previous build if the new one fails. A merged PR is therefore
  live by the next morning. `repohq-web update --force` deploys it now.
- **Env:** the launcher reads every value from the macOS keychain (`vault/RepoHQ/<NAME>`) at start. There is
  no `.env` file and nothing in the plist. `repohq-web env` lists what's missing, names only.
- **Sign-in:** `AUTH_TRUST_HOST=true` and no `AUTH_URL`, so Auth.js builds the callback from the URL the page
  is opened on. The GitHub OAuth app's callback URL must match that host:
  - `http://localhost:3200/api/auth/callback/github` on the Mac;
  - `https://<mac>.<tailnet>.ts.net/api/auth/callback/github` once `tailscale serve --bg 3200` is on.

  An OAuth App holds one callback URL, so pick the Tailscale one once it works and use that URL on the Mac
  too.
- **CSP:** the launcher builds with `CSP_UPGRADE_INSECURE=0` (`next.config.ts`). The Mac serves plain http on
  localhost, and with `upgrade-insecure-requests` Chromium rewrites the sign-in POST and RSC fetches to https
  that isn't there. Vercel builds leave the variable unset and keep the directive.
- **Crons:** `~/ai-stack/bin/repohq-cron-runner.sh` (launchd `com.repohq.crons`, every 4 h) calls
  `/api/cron/*` on the local server, with the bearer token from the keychain.

## What doesn't work from the Mac

- Anything outside the tailnet that calls RepoHQ: idea landing pages posting to `/api/ideas/signal`, public
  `/u/<username>` profile links, and the `repohq.vercel.app` links in emails and briefs.
- The system-events collector still probes `https://repohq.vercel.app/api/health`
  (`factory/system/collector.ts`), so it reports the app as down until it points at the local server.

## Going back to Vercel

Vercel still has the project and its env. Once the block lifts (or on Pro), `vercel deploy --prod`, or the
daily `~/ai-stack/bin/release` job, brings https://repohq.vercel.app back. Then point the cron runner at it
(`repohq-cron-runner.sh https://repohq.vercel.app`) and boot out `com.localai.repohq-web` and
`com.localai.repohq-web-update`.
