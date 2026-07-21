import { describe, expect, it } from "vitest";
import type { StructuredLlm } from "../src/llm/adapter.js";
import { generateDailyBrief } from "../src/pipeline/generate-brief.js";
import type { ContentCluster } from "../src/pipeline/cluster.js";

describe("generateDailyBrief", () => {
  it("preserves non-Chinese builder originals and adds a model translation", async () => {
    const clusters: ContentCluster[] = [{
      id: "cluster-1",
      items: [{
        id: "source-1",
        sourceType: "zara-x",
        sourceName: "Zara X",
        author: "Builder",
        content: "Agents need explicit boundaries and recoverable state.",
        url: "https://example.com/source-1",
        collectedAt: "2026-07-21T00:00:00.000Z",
        fingerprint: "fingerprint-1",
        status: "kept",
      }],
    }, {
      id: "cluster-2",
      items: [{
        id: "source-2",
        sourceType: "zara-x",
        sourceName: "Zara X",
        author: "Another Builder",
        content: "Products should make automated decisions visible to users.",
        url: "https://example.com/source-2",
        collectedAt: "2026-07-21T00:05:00.000Z",
        fingerprint: "fingerprint-2",
        status: "kept",
      }],
    }];
    const llm: StructuredLlm = {
      async generate(prompt, schema) {
        if (prompt.includes("忠实翻译")) {
          return schema.parse({ translatedContent: "Agent 需要明确的边界和可恢复的状态。" });
        }
        return schema.parse({
          title: "Agent 产品开始重视可恢复性",
          deck: "今天的讨论集中在任务边界、恢复能力与自动决策的可见性。",
          highlights: [],
          builderTopics: [{
            id: "topic-1",
            title: "Agent 产品",
            entries: [{
              id: "cluster-1",
              title: "可恢复状态",
              summary: "Builder 强调任务边界。",
              sourceItemIds: ["source-1"],
            }],
          }],
          githubTrending: [],
          suggestedActions: [],
        });
      },
    };

    const brief = await generateDailyBrief({
      date: "2026-07-21",
      clusters,
      githubRepositories: [],
      collected: 1,
      kept: 1,
      dropped: 0,
      merged: 0,
      rawItems: clusters.flatMap((cluster) => cluster.items),
      llm,
      now: () => new Date("2026-07-21T01:00:00.000Z"),
    });

    const source = brief.builderTopics[0]?.entries[0]?.sourceItems?.[0];
    expect(source?.content).toBe("Agents need explicit boundaries and recoverable state.");
    expect(source?.translatedContent).toBe("Agent 需要明确的边界和可恢复的状态。");
    const publishedSourceIds = brief.builderTopics
      .flatMap((topic) => topic.entries)
      .flatMap((entry) => entry.sourceItemIds);
    expect(publishedSourceIds).toEqual(expect.arrayContaining(["source-1", "source-2"]));
    expect(brief.rawItems).toHaveLength(2);
    expect(brief.title).toBe("Agent 产品开始重视可恢复性");
    expect(brief.deck).toContain("任务边界");
  });
});
