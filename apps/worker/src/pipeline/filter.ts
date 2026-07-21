import type { ContentItem } from "../schemas.js";

export interface FilterResult {
  kept: ContentItem[];
  dropped: ContentItem[];
}

const DEFAULT_NOISE_PATTERNS = [
  /\b(world cup|nba|nfl|football match|soccer match)\b/i,
  /\b(happy birthday|good morning|good night)\b/i,
  /(世界杯|足球比赛|篮球比赛|生日快乐|晚安)/i,
];

export function filterItems(
  items: ContentItem[],
  options?: {
    minContentLength?: number;
    noisePatterns?: RegExp[];
    now?: Date;
    maxAgeHours?: number;
  },
): FilterResult {
  const kept: ContentItem[] = [];
  const dropped: ContentItem[] = [];
  const minContentLength = options?.minContentLength ?? 20;
  const patterns = options?.noisePatterns ?? DEFAULT_NOISE_PATTERNS;
  const maxAgeMs = (options?.maxAgeHours ?? 36) * 60 * 60 * 1000;
  const now = options?.now ?? new Date();

  for (const item of items) {
    let reason: string | undefined;
    if (!item.content.trim() && !item.title?.trim()) {
      reason = "Empty content";
    } else if (
      item.sourceType !== "github-trending" &&
      item.content.trim().length < minContentLength
    ) {
      reason = "Content is too short to evaluate";
    } else if (patterns.some((pattern) => pattern.test(item.content))) {
      reason = "Matched a deterministic noise rule";
    } else if (
      item.publishedAt &&
      now.valueOf() - new Date(item.publishedAt).valueOf() > maxAgeMs
    ) {
      reason = "Outside the collection time window";
    }

    if (reason) {
      dropped.push({ ...item, status: "dropped", decisionReason: reason });
    } else {
      kept.push({ ...item, status: "kept" });
    }
  }
  return { kept, dropped };
}
