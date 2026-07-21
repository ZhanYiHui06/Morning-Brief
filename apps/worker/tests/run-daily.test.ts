import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDaily } from "../src/run-daily.js";
import { dailyBriefSchema } from "../src/schemas.js";

describe("runDaily", () => {
  it("uses injectable network dependencies and writes snapshots atomically", async () => {
    const fixtureDirectory = path.join(import.meta.dirname, "fixtures");
    const zaraPayload = await readFile(
      path.join(fixtureDirectory, "zara-feed.json"),
      "utf8",
    );
    const trendingHtml = await readFile(
      path.join(fixtureDirectory, "github-trending.html"),
      "utf8",
    );
    const dataDirectory = await mkdtemp(
      path.join(tmpdir(), "morning-brief-worker-"),
    );
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("zara.test")) {
        return new Response(zaraPayload, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("github.test")) {
        return new Response(trendingHtml, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const config = {
      date: "2026-07-21",
      dataDirectory,
      zaraSources: [
        {
          name: "Zara X",
          type: "zara-x" as const,
          url: "https://zara.test/feed-x.json",
        },
      ],
      githubTrendingUrl: "https://github.test/trending",
    };
    const dependencies = {
      fetcher,
      now: () => new Date("2026-07-21T02:00:00.000Z"),
    };
    const brief = await runDaily(config, dependencies);

    expect(brief.status).toBe("fallback");
    expect(brief.githubTrending).toHaveLength(5);
    expect(brief.sourceStats).toMatchObject({
      collected: 8,
      kept: 6,
      dropped: 1,
      merged: 1,
    });
    const saved = JSON.parse(
      await readFile(
        path.join(dataDirectory, "briefs", "2026-07-21.json"),
        "utf8",
      ),
    ) as unknown;
    expect(dailyBriefSchema.parse(saved).date).toBe("2026-07-21");

    // A second run overwrites the same snapshot paths. This specifically
    // exercises Windows' rename-over-existing-file fallback.
    await expect(runDaily(config, dependencies)).resolves.toMatchObject({
      id: "brief:2026-07-21",
    });
  });
});
