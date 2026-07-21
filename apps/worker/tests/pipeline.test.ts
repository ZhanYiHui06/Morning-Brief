import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ZaraFeedSnapshot } from "../src/collectors/zara.js";
import { deduplicateItems } from "../src/pipeline/deduplicate.js";
import { filterItems } from "../src/pipeline/filter.js";
import { normalizeZaraSnapshots } from "../src/pipeline/normalize.js";
import { scoreItems } from "../src/pipeline/score.js";

describe("content pipeline", () => {
  it("normalizes, fingerprints, deduplicates, filters noise and scores", async () => {
    const payload = JSON.parse(
      await readFile(
        path.join(import.meta.dirname, "fixtures", "zara-feed.json"),
        "utf8",
      ),
    ) as unknown;
    const snapshots: ZaraFeedSnapshot[] = [
      {
        source: {
          name: "Zara X",
          type: "zara-x",
          url: "https://example.test/feed-x.json",
        },
        collectedAt: "2026-07-21T01:00:00.000Z",
        payload,
      },
    ];

    const normalized = normalizeZaraSnapshots(snapshots);
    const deduplicated = deduplicateItems(normalized);
    const filtered = filterItems(deduplicated.unique, {
      now: new Date("2026-07-21T02:00:00.000Z"),
    });
    const scored = scoreItems(filtered.kept);

    expect(normalized).toHaveLength(3);
    expect(deduplicated.unique).toHaveLength(2);
    expect(deduplicated.duplicates).toHaveLength(1);
    expect(filtered.kept).toHaveLength(1);
    expect(filtered.dropped[0]?.decisionReason).toMatch(/noise/i);
    expect(filtered.dropped[0]?.status).toBe("dropped");
    expect(scored[0]?.totalScore).toBeGreaterThan(5);
  });
});
