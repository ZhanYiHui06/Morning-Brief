import type { ContentItem } from "../schemas.js";

export interface ScoreWeights {
  importance: number;
  relevance: number;
  novelty: number;
  actionability: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  importance: 0.3,
  relevance: 0.35,
  novelty: 0.2,
  actionability: 0.15,
};

function keywordScore(text: string, words: string[]): number {
  const matches = words.filter((word) => text.includes(word)).length;
  return Math.min(10, 4 + matches);
}

export function scoreItems(
  items: ContentItem[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): ContentItem[] {
  return items
    .map((item) => {
      const text = `${item.title ?? ""} ${item.content}`.toLowerCase();
      const relevance =
        item.relevanceScore ??
        keywordScore(text, [
          "agent",
          "claude",
          "codex",
          "ai",
          "model",
          "product",
          "developer",
          "workflow",
        ]);
      const importance =
        item.importanceScore ??
        keywordScore(text, ["launch", "release", "new", "open source", "发布"]);
      const novelty = item.noveltyScore ?? (item.publishedAt ? 7 : 5);
      const actionability =
        item.actionabilityScore ??
        keywordScore(text, ["try", "build", "tool", "github", "教程"]);
      const total =
        importance * weights.importance +
        relevance * weights.relevance +
        novelty * weights.novelty +
        actionability * weights.actionability;
      return {
        ...item,
        importanceScore: importance,
        relevanceScore: relevance,
        noveltyScore: novelty,
        actionabilityScore: actionability,
        totalScore: Math.round(total * 100) / 100,
      };
    })
    .sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));
}
