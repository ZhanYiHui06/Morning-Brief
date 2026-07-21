import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(url = process.env.DATABASE_URL ?? "./data/morning-brief.sqlite") {
  const windowsPath = /^[a-z]:[\\/]/i.test(url);
  const hasUrlScheme = !windowsPath && /^[a-z][a-z0-9+.-]*:/i.test(url);
  const normalizedUrl = url === ":memory:"
    ? "file::memory:"
    : hasUrlScheme
      ? url
      : pathToFileURL(path.resolve(url)).href;
  const client = createClient({ url: normalizedUrl });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function migrate(client: ReturnType<typeof createClient>) {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_name TEXT NOT NULL,
      external_id TEXT, author TEXT, title TEXT, content TEXT NOT NULL, url TEXT NOT NULL,
      published_at TEXT, collected_at TEXT NOT NULL, category TEXT,
      relevance_score INTEGER, importance_score INTEGER, novelty_score INTEGER,
      actionability_score INTEGER, status TEXT NOT NULL DEFAULT 'pending',
      decision_reason TEXT, event_id TEXT, fingerprint TEXT UNIQUE, raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS content_status_idx ON content_items(status);
    CREATE INDEX IF NOT EXISTS content_collected_at_idx ON content_items(collected_at);
    CREATE TABLE IF NOT EXISTS daily_briefs (
      id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'draft',
      title TEXT NOT NULL, generated_at TEXT NOT NULL, payload_json TEXT NOT NULL,
      published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, protocol TEXT NOT NULL DEFAULT 'openai-compatible',
      base_url TEXT NOT NULL, secret_env_ref TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL, display_name TEXT NOT NULL, context_window INTEGER,
      max_output_tokens INTEGER, supports_structured_output INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS task_routes (
      id TEXT PRIMARY KEY, task_kind TEXT NOT NULL UNIQUE,
      primary_model_id TEXT NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
      fallback_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
      timeout_ms INTEGER NOT NULL DEFAULT 60000, max_retries INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY, task_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      requested_by TEXT NOT NULL DEFAULT 'admin', input_json TEXT, result_json TEXT, error TEXT,
      started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS run_status_idx ON pipeline_runs(status);
    CREATE TABLE IF NOT EXISTS delivery_records (
      id TEXT PRIMARY KEY, brief_id TEXT NOT NULL REFERENCES daily_briefs(id) ON DELETE CASCADE,
      channel TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0, sent_at TEXT, error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(brief_id, channel, content_hash)
    );
  `);
}
