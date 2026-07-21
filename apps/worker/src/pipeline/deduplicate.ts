import type { ContentItem } from "../schemas.js";

export interface DeduplicationResult {
  unique: ContentItem[];
  duplicates: ContentItem[];
}

export function deduplicateItems(
  items: ContentItem[],
): DeduplicationResult {
  const seen = new Set<string>();
  const unique: ContentItem[] = [];
  const duplicates: ContentItem[] = [];
  for (const item of items) {
    if (seen.has(item.fingerprint)) {
      duplicates.push({
        ...item,
        status: "merged",
        decisionReason: "Duplicate content fingerprint",
      });
    } else {
      seen.add(item.fingerprint);
      unique.push(item);
    }
  }
  return { unique, duplicates };
}
