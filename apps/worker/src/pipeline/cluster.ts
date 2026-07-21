import { createHash } from "node:crypto";
import type { ContentItem } from "../schemas.js";

export interface ContentCluster {
  id: string;
  items: ContentItem[];
}

export interface EventClusterer {
  cluster(items: ContentItem[]): Promise<ContentCluster[]>;
}

function significantWords(item: ContentItem): Set<string> {
  return new Set(
    `${item.title ?? ""} ${item.content}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4)
      .slice(0, 40),
  );
}

function similarity(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export class HeuristicEventClusterer implements EventClusterer {
  constructor(private readonly threshold = 0.35) {}

  async cluster(items: ContentItem[]): Promise<ContentCluster[]> {
    const clusters: Array<ContentCluster & { words: Set<string> }> = [];
    for (const item of items) {
      const words = significantWords(item);
      const match = clusters.find(
        (cluster) => similarity(cluster.words, words) >= this.threshold,
      );
      if (match) {
        match.items.push({ ...item, eventId: match.id });
        match.words = new Set([...match.words, ...words]);
      } else {
        const id = createHash("sha256")
          .update(item.fingerprint)
          .digest("hex")
          .slice(0, 16);
        clusters.push({
          id,
          items: [{ ...item, eventId: id }],
          words,
        });
      }
    }
    return clusters.map(({ id, items: clusterItems }) => ({
      id,
      items: clusterItems,
    }));
  }
}
