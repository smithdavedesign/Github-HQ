-- System events (docs/logging.md): one log across RepoHQ, the factory, the idea pipeline, the local AI
-- stack, OpenClaw, launchd and GitHub crons. Mirrors src/lib/db/schema.ts `systemEvents`. Idempotent.
CREATE TABLE IF NOT EXISTS "system_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"system" text NOT NULL,
	"component" text NOT NULL,
	"event" text NOT NULL,
	"status" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"run_id" text,
	"subject" jsonb,
	"data" jsonb,
	"duration_ms" integer,
	"host" text,
	"fingerprint" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "system_events_ts_idx" ON "system_events" USING btree ("ts");
CREATE INDEX IF NOT EXISTS "system_events_system_ts_idx" ON "system_events" USING btree ("system","ts");
CREATE INDEX IF NOT EXISTS "system_events_fingerprint_ts_idx" ON "system_events" USING btree ("fingerprint","ts");
