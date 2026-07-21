import { z } from "zod";

export const sourceTypeSchema = z.enum([
  "zara-x",
  "zara-podcast",
  "zara-blog",
  "github-trending",
]);

export type SourceType = z.infer<typeof sourceTypeSchema>;

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
  author: z.string().optional(),
  title: z.string().optional(),
  content: z.string(),
  url: z.string().url(),
  publishedAt: z.string().datetime().optional(),
  collectedAt: z.string().datetime(),
  category: z.string().optional(),
  relevanceScore: z.number().int().min(0).max(10).optional(),
  importanceScore: z.number().int().min(0).max(10).optional(),
  noveltyScore: z.number().int().min(0).max(10).optional(),
  actionabilityScore: z.number().int().min(0).max(10).optional(),
  totalScore: z.number().min(0).max(10).optional(),
  status: contentStatusSchema.default("pending"),
  decisionReason: z.string().optional(),
  eventId: z.string().optional(),
  fingerprint: z.string().min(1),
  raw: z.unknown().optional(),
});

export type ContentItem = z.infer<typeof contentItemSchema>;

export const githubRepositorySchema = z.object({
  rank: z.number().int().positive(),
  fullName: z.string().regex(/^[^/]+\/[^/]+$/),
  url: z.string().url(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  totalStars: z.number().int().nonnegative().nullable(),
  forks: z.number().int().nonnegative().nullable(),
  starsToday: z.number().int().nonnegative().nullable(),
  readme: z.string().optional(),
  readmeTruncated: z.boolean().optional(),
});

export type GitHubRepository = z.infer<typeof githubRepositorySchema>;

export const briefSourceItemSchema = z.object({
  id: z.string().min(1),
  author: z.string().optional(),
  sourceName: z.string().min(1),
  content: z.string(),
  translatedContent: z.string().optional(),
  url: z.string().url(),
  publishedAt: z.string().datetime().optional(),
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
  sourceNames: z.array(z.string()).optional(),
  sourceItems: z.array(briefSourceItemSchema).optional(),
  score: z.number().min(0).max(10).optional(),
});

export const topicGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  entries: z.array(briefEntrySchema),
});

export const githubBriefEntrySchema = githubRepositorySchema.extend({
  summary: z.string(),
  category: z.string(),
  relevance: z.enum(["high", "medium", "low"]),
  relevanceReason: z.string(),
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
  githubTrending: z.array(githubBriefEntrySchema).max(5),
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

export type DailyBrief = z.infer<typeof dailyBriefSchema>;

export const llmBriefContentSchema = z.object({
  title: z.string().min(1),
  deck: z.string().min(1),
  highlights: z.array(briefEntrySchema).max(3),
  builderTopics: z.array(topicGroupSchema),
  githubTrending: z.array(githubBriefEntrySchema).max(5),
  suggestedActions: z.array(z.string()).max(2),
});

export const llmGeneratedContentSchema = z.object({
  title: z.string().min(1),
  deck: z.string().min(1),
  highlights: z.array(briefEntrySchema).max(3),
  builderTopics: z.array(topicGroupSchema),
  githubTrending: z.array(z.object({
    fullName: z.string().regex(/^[^/]+\/[^/]+$/),
    summary: z.string(),
    category: z.string(),
    relevance: z.enum(["high", "medium", "low"]),
    relevanceReason: z.string(),
  })).max(5),
  suggestedActions: z.array(z.string()).max(2),
});

export const translationResultSchema = z.union([
  z.object({ translatedContent: z.string().min(1) }),
  z.object({ translation: z.string().min(1) }),
  z.object({ translated_text: z.string().min(1) }),
  z.object({ text: z.string().min(1) }),
]).transform((value) => ({
  translatedContent: "translatedContent" in value
    ? value.translatedContent
    : "translation" in value
      ? value.translation
      : "translated_text" in value
        ? value.translated_text
        : value.text,
}));

export type LlmBriefContent = z.infer<typeof llmBriefContentSchema>;
