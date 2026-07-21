import { serve } from "@hono/node-server";
import {
  createDatabase,
  migrate,
  models,
  providers,
  taskRoutes,
} from "@morning-brief/database";
import { createApp } from "./app.js";
import { ProcessTaskRunner } from "./runner.js";

const { db, client } = createDatabase();
await migrate(client);

const defaultBaseUrl = process.env.LLM_BASE_URL;
const defaultModel = process.env.LLM_MODEL;
if (defaultBaseUrl && defaultModel && process.env.MORNING_BRIEF_LLM_API_KEY) {
  await db.insert(providers).values({
    id: "provider:production-default",
    name: "Production LLM",
    protocol: "openai-compatible",
    baseUrl: defaultBaseUrl,
    secretEnvRef: "MORNING_BRIEF_LLM_API_KEY",
    enabled: true,
  }).onConflictDoNothing().run();
  await db.insert(models).values({
    id: "model:production-default",
    providerId: "provider:production-default",
    modelId: defaultModel,
    displayName: defaultModel,
    supportsStructuredOutput: true,
    enabled: true,
  }).onConflictDoNothing().run();
  await db.insert(taskRoutes).values({
    id: "route:daily-overview",
    taskKind: "daily-overview",
    primaryModelId: "model:production-default",
    timeoutMs: 120_000,
    maxRetries: 1,
  }).onConflictDoNothing().run();
}

const port = Number(process.env.ADMIN_API_PORT ?? process.env.PORT ?? 8787);
const hostname = process.env.ADMIN_API_HOST ?? "127.0.0.1";
const runner = process.env.NODE_ENV === "production"
  ? new ProcessTaskRunner()
  : undefined;
serve({ fetch: createApp({ db, ...(runner ? { runner } : {}) }).fetch, port, hostname });
console.log(`Morning Brief admin API listening on http://${hostname}:${port}`);
