import { z } from "zod";

export const sourceTypeSchema = z.enum([
  "zara-x",
  "zara-podcast",
  "zara-blog",
  "github-trending",
]);

export const contentStatusSchema = z.enum([
  "pending",
  "kept",
  "dropped",
  "merged",
  "published",
]);

export const contentItemSchema = z.object({
  id: z.string().min(1),
  sourceType: sourceTypeSchema,
  sourceName: z.string().min(1),
  externalId: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  content: z.string(),
  url: z.string().url(),
  publishedAt: z.string().datetime().nullable().optional(),
  collectedAt: z.string().datetime(),
  category: z.string().nullable().optional(),
  relevanceScore: z.number().int().min(0).max(10).nullable().optional(),
  importanceScore: z.number().int().min(0).max(10).nullable().optional(),
  noveltyScore: z.number().int().min(0).max(10).nullable().optional(),
  actionabilityScore: z.number().int().min(0).max(10).nullable().optional(),
  status: contentStatusSchema.default("pending"),
  decisionReason: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  fingerprint: z.string().nullable().optional(),
  raw: z.unknown().optional(),
});

export const briefSourceItemSchema = z.object({
  id: z.string().min(1),
  author: z.string().nullable().optional(),
  sourceName: z.string().min(1),
  content: z.string(),
  translatedContent: z.string().nullable().optional(),
  url: z.string().url(),
  publishedAt: z.string().datetime().nullable().optional(),
});

export const rawBriefItemSchema = z.object({
  id: z.string().min(1),
  sourceType: sourceTypeSchema,
  sourceName: z.string().min(1),
  author: z.string().optional(),
  title: z.string().optional(),
  content: z.string(),
  url: z.string().url(),
  publishedAt: z.string().datetime().optional(),
  collectedAt: z.string().datetime(),
});

export const briefEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  whyItMatters: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  sourceItemIds: z.array(z.string()).default([]),
  sourceItems: z.array(briefSourceItemSchema).optional(),
});

export const topicGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  entries: z.array(briefEntrySchema),
});

export const githubEntrySchema = z.object({
  rank: z.number().int().positive(),
  fullName: z.string().min(1),
  url: z.string().url(),
  language: z.string().nullable().optional(),
  totalStars: z.number().int().nonnegative().nullable().optional(),
  starsToday: z.number().int().nonnegative().nullable().optional(),
  summary: z.string(),
  relevance: z.enum(["low", "medium", "high"]).nullable().optional(),
});

export const dailyBriefSchema = z.object({
  id: z.string().min(1),
  date: z.string().date(),
  generatedAt: z.string().datetime(),
  status: z.enum(["draft", "complete", "partial", "fallback", "published"]),
  title: z.string().min(1),
  deck: z.string().min(1).optional(),
  highlights: z.array(briefEntrySchema).max(3),
  builderTopics: z.array(topicGroupSchema),
  githubTrending: z.array(githubEntrySchema).max(5),
  suggestedActions: z.array(z.string()).max(2),
  warnings: z.array(z.string()),
  sourceStats: z.object({
    collected: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    merged: z.number().int().nonnegative(),
  }),
  rawItems: z.array(rawBriefItemSchema).default([]),
});

export const providerProtocolSchema = z.enum([
  "openai-compatible",
  "anthropic",
]);

export const providerInputSchema = z.object({
  name: z.string().min(1),
  protocol: providerProtocolSchema.default("openai-compatible"),
  baseUrl: z.string().url(),
  secretEnvRef: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, "must be an environment variable name"),
  enabled: z.boolean().default(true),
}).strict();

export const modelInputSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  supportsStructuredOutput: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const taskKindSchema = z.enum([
  "filter",
  "score",
  "cluster",
  "builder-summary",
  "github-summary",
  "daily-overview",
  "suggest-actions",
]);

export const taskRouteInputSchema = z.object({
  taskKind: taskKindSchema,
  primaryModelId: z.string().min(1),
  fallbackModelId: z.string().min(1).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  maxRetries: z.number().int().min(0).max(5).default(1),
});

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const deliveryStatusSchema = z.enum([
  "pending",
  "sent",
  "failed",
  "skipped",
]);

export type ContentItem = z.infer<typeof contentItemSchema>;
export type DailyBrief = z.infer<typeof dailyBriefSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ModelInput = z.infer<typeof modelInputSchema>;
export type TaskRouteInput = z.infer<typeof taskRouteInputSchema>;
