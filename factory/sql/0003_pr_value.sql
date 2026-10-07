-- 30-day experiment (roadmap "Experiment B"): the owner's 0–5 rating of a factory PR, read from
-- its `value:N` label by the factory's reconcile step (src/lib/agents/pr-value.ts).
-- Idempotent. Apply: npm run factory:migrate (or npm run db:push).
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "value" integer;
