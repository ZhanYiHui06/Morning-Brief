import * as cheerio from "cheerio";
import {
  githubRepositorySchema,
  type GitHubRepository,
} from "../schemas.js";

export const GITHUB_TRENDING_DAILY_URL =
  "https://github.com/trending?since=daily";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseCount(value: string): number | null {
  const match = cleanText(value).replaceAll(",", "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function parseGitHubTrending(
  html: string,
  limit = 5,
): GitHubRepository[] {
  const $ = cheerio.load(html);
  const repositories: GitHubRepository[] = [];

  $("article.Box-row")
    .slice(0, limit)
    .each((_, element) => {
      const row = $(element);
      const repositoryLink = row.find("h2 a").first();
      const href = repositoryLink.attr("href");
      if (!href) return;

      const fullName = cleanText(repositoryLink.text()).replace(
        /\s*\/\s*/g,
        "/",
      );
      const item = {
        rank: repositories.length + 1,
        fullName,
        url: new URL(href, "https://github.com").toString(),
        description: cleanText(row.find("p").first().text()) || null,
        language:
          cleanText(
            row.find('[itemprop="programmingLanguage"]').first().text(),
          ) || null,
        totalStars: parseCount(
          row.find('a[href$="/stargazers"]').first().text(),
        ),
        forks: parseCount(row.find('a[href$="/forks"]').first().text()),
        starsToday: parseCount(
          row.find("span.d-inline-block.float-sm-right").first().text(),
        ),
      };
      repositories.push(githubRepositorySchema.parse(item));
    });

  if (repositories.length === 0) {
    throw new Error(
      "No GitHub Trending repositories parsed; page structure may have changed",
    );
  }
  return repositories;
}

export async function collectGitHubTrending(options?: {
  fetcher?: typeof fetch;
  url?: string;
  limit?: number;
  timeoutMs?: number;
}): Promise<GitHubRepository[]> {
  const fetcher = options?.fetcher ?? fetch;
  const response = await fetcher(
    options?.url ?? GITHUB_TRENDING_DAILY_URL,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "MorningBriefBot/0.1",
      },
      signal: AbortSignal.timeout(options?.timeoutMs ?? 20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub Trending request failed: HTTP ${response.status}`);
  }
  return parseGitHubTrending(await response.text(), options?.limit ?? 5);
}
