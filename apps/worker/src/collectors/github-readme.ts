import type { GitHubRepository } from "../schemas.js";

export interface GitHubReadmeClient {
  getReadme(fullName: string): Promise<string | null>;
}

export class GitHubApiReadmeClient implements GitHubReadmeClient {
  constructor(
    private readonly options: {
      token?: string;
      fetcher?: typeof fetch;
      maxCharacters?: number;
      timeoutMs?: number;
      apiBaseUrl?: string;
    } = {},
  ) {}

  async getReadme(fullName: string): Promise<string | null> {
    const fetcher = this.options.fetcher ?? fetch;
    const headers: Record<string, string> = {
      accept: "application/vnd.github.raw+json",
      "user-agent": "MorningBriefBot/0.1",
      "x-github-api-version": "2022-11-28",
    };
    if (this.options.token) {
      headers.authorization = `Bearer ${this.options.token}`;
    }

    const response = await fetcher(
      `${this.options.apiBaseUrl ?? "https://api.github.com"}/repos/${fullName}/readme`,
      {
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `GitHub README request for "${fullName}" failed: HTTP ${response.status}`,
      );
    }
    return (await response.text()).slice(
      0,
      (this.options.maxCharacters ?? 10_000) + 1,
    );
  }
}

export async function enrichWithReadmes(
  repositories: GitHubRepository[],
  client: GitHubReadmeClient,
  maxCharacters = 10_000,
): Promise<GitHubRepository[]> {
  return Promise.all(
    repositories.map(async (repository) => {
      const readme = await client.getReadme(repository.fullName);
      if (readme === null) return repository;
      return {
        ...repository,
        readme: readme.slice(0, maxCharacters),
        readmeTruncated: readme.length > maxCharacters,
      };
    }),
  );
}
