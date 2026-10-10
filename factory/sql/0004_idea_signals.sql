-- Idea pipeline validation (docs/idea-factory.md): landing-page views and waitlist signups per idea.
-- Mirrors src/lib/db/schema.ts `ideaSignals`. Idempotent. Apply: npm run factory:migrate
CREATE TABLE IF NOT EXISTS "idea_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"email" text,
	"ip_hash" text,
	"referrer" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idea_signals_slug_kind_idx" ON "idea_signals" USING btree ("slug","kind");
CREATE INDEX IF NOT EXISTS "idea_signals_ip_created_idx" ON "idea_signals" USING btree ("ip_hash","created_at");
