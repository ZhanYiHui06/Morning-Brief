import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGitHubTrending } from "../src/collectors/github-trending.js";

describe("parseGitHubTrending", () => {
  it("preserves the official order and returns only the first five", async () => {
    const html = await readFile(
      path.join(import.meta.dirname, "fixtures", "github-trending.html"),
      "utf8",
    );
    const repositories = parseGitHubTrending(html);

    expect(repositories).toHaveLength(5);
    expect(repositories[0]).toMatchObject({
      rank: 1,
      fullName: "alpha/agent-kit",
      language: "TypeScript",
      totalStars: 12_345,
      forks: 678,
      starsToday: 1_234,
    });
    expect(repositories[4]?.fullName).toBe("epsilon/ops");
  });

  it("fails loudly when the page structure no longer matches", () => {
    expect(() => parseGitHubTrending("<html></html>")).toThrow(
      /page structure may have changed/i,
    );
  });
});
