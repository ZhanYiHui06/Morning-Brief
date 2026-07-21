import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
};

export const contentItems = sqliteTable(
  "content_items",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    externalId: text("external_id"),
    author: text("author"),
    title: text("title"),
    content: text("content").notNull(),
    url: text("url").notNull(),
    publishedAt: text("published_at"),
    collectedAt: text("collected_at").notNull(),
    category: text("category"),
    relevanceScore: integer("relevance_score"),
    importanceScore: integer("importance_score"),
    noveltyScore: integer("novelty_score"),
    actionabilityScore: integer("actionability_score"),
    status: text("status").notNull().default("pending"),
    decisionReason: text("decision_reason"),
    eventId: text("event_id"),
    fingerprint: text("fingerprint"),
    rawJson: text("raw_json"),
    ...timestamps,
  },
  (table) => [
    index("content_status_idx").on(table.status),
    index("content_collected_at_idx").on(table.collectedAt),
    uniqueIndex("content_fingerprint_idx").on(table.fingerprint),
  ],
);

export const dailyBriefs = sqliteTable(
  "daily_briefs",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    generatedAt: text("generated_at").notNull(),
    payloadJson: text("payload_json").notNull(),
    publishedAt: text("published_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("brief_date_idx").on(table.date)],
);

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    protocol: text("protocol").notNull().default("openai-compatible"),
    baseUrl: text("base_url").notNull(),
    secretEnvRef: text("secret_env_ref").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("provider_name_idx").on(table.name)],
);

export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    supportsStructuredOutput: integer("supports_structured_output", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("model_provider_external_idx").on(
      table.providerId,
      table.modelId,
    ),
  ],
);

export const taskRoutes = sqliteTable("task_routes", {
  id: text("id").primaryKey(),
  taskKind: text("task_kind").notNull().unique(),
  primaryModelId: text("primary_model_id")
    .notNull()
    .references(() => models.id, { onDelete: "restrict" }),
  fallbackModelId: text("fallback_model_id").references(() => models.id, {
    onDelete: "set null",
  }),
  timeoutMs: integer("timeout_ms").notNull().default(60000),
  maxRetries: integer("max_retries").notNull().default(1),
  ...timestamps,
});

export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    taskName: text("task_name").notNull(),
    status: text("status").notNull().default("queued"),
    requestedBy: text("requested_by").notNull().default("admin"),
    inputJson: text("input_json"),
    resultJson: text("result_json"),
    error: text("error"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    ...timestamps,
  },
  (table) => [index("run_status_idx").on(table.status)],
);

export const deliveryRecords = sqliteTable(
  "delivery_records",
  {
    id: text("id").primaryKey(),
    briefId: text("brief_id")
      .notNull()
      .references(() => dailyBriefs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    sentAt: text("sent_at"),
    error: text("error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("delivery_dedupe_idx").on(
      table.briefId,
      table.channel,
      table.contentHash,
    ),
  ],
);
