import path from "node:path";
import {
  collectZaraFeeds,
  type ZaraFeedSource,
} from "./collectors/zara.js";
import { collectGitHubTrending } from "./collectors/github-trending.js";
import {
  enrichWithReadmes,
  type GitHubReadmeClient,
} from "./collectors/github-readme.js";
import type { StructuredLlm } from "./llm/adapter.js";
import {
  normalizeGitHubRepositories,
  normalizeZaraSnapshots,
} from "./pipeline/normalize.js";
import { deduplicateItems } from "./pipeline/deduplicate.js";
import { filterItems } from "./pipeline/filter.js";
import { scoreItems } from "./pipeline/score.js";
import {
  HeuristicEventClusterer,
  type EventClusterer,
} from "./pipeline/cluster.js";
import { generateDailyBrief } from "./pipeline/generate-brief.js";
import type { ContentItem, DailyBrief } from "./schemas.js";
import {
  briefPath,
  snapshotPath,
  writeJsonAtomically,
} from "./storage/json-store.js";

export interface DailyRunDependencies {
  fetcher?: typeof fetch;
  readmeClient?: GitHubReadmeClient;
  clusterer?: EventClusterer;
  llm?: StructuredLlm;
  now?: () => Date;
  resultSink?: (result: DailyRunResult) => Promise<void>;
}

export interface DailyRunResult {
  brief: DailyBrief;
  contentItems: ContentItem[];
}

export interface DailyRunConfig {
  date: string;
  dataDirectory: string;
  zaraSources: ZaraFeedSource[];
  githubTrendingUrl?: string;
  githubLimit?: number;
}

export async function runDaily(
  config: DailyRunConfig,
  dependencies: DailyRunDependencies = {},
): Promise<DailyBrief> {
  const now = dependencies.now ?? (() => new Date());
  const warnings: string[] = [];
  const zaraSnapshots = await collectZaraFeeds({
    sources: config.zaraSources,
    ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}),
    now,
  });
  await Promise.all(
    zaraSnapshots.map((snapshot) =>
      writeJsonAtomically(
        snapshotPath(
          config.dataDirectory,
          config.date,
          snapshot.source.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
        ),
        snapshot,
      ),
    ),
  );

  let repositories = await collectGitHubTrending({
    ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}),
    ...(config.githubTrendingUrl ? { url: config.githubTrendingUrl } : {}),
    limit: config.githubLimit ?? 5,
  });
  if (repositories.length < (config.githubLimit ?? 5)) {
    warnings.push(
      `GitHub Trending returned ${repositories.length} repositories`,
    );
  }
  if (dependencies.readmeClient) {
    repositories = await enrichWithReadmes(
      repositories,
      dependencies.readmeClient,
    );
  }
  await writeJsonAtomically(
    snapshotPath(config.dataDirectory, config.date, "github-trending"),
    { collectedAt: now().toISOString(), repositories },
  );

  const items = [
    ...normalizeZaraSnapshots(zaraSnapshots),
    ...normalizeGitHubRepositories(repositories, now().toISOString()),
  ];
  const { unique, duplicates } = deduplicateItems(items);
  const filtered = filterItems(unique, { now: now() });
  const scored = scoreItems(filtered.kept);
  const githubItems = scored.filter(
    (item) => item.sourceType === "github-trending",
  );
  const rankedBuilderItems = scored.filter(
    (item) => item.sourceType !== "github-trending",
  );
  const builderLimit = 15;
  const builderItems = rankedBuilderItems.slice(0, builderLimit);
  const editorialDrops = rankedBuilderItems.slice(builderLimit).map((item) => ({
    ...item,
    status: "dropped" as const,
    decisionReason: `Below the daily top ${builderLimit} editorial score cutoff`,
  }));
  const clusters = await (
    dependencies.clusterer ?? new HeuristicEventClusterer()
  ).cluster(builderItems);
  const brief = await generateDailyBrief({
    date: config.date,
    clusters,
    githubRepositories: repositories,
    collected: items.length,
    kept: builderItems.length + githubItems.length,
    dropped: filtered.dropped.length + editorialDrops.length,
    merged: duplicates.length,
    rawItems: items,
    now,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(dependencies.llm ? { llm: dependencies.llm } : {}),
  });
  await writeJsonAtomically(
    briefPath(config.dataDirectory, config.date),
    brief,
  );
  if (dependencies.resultSink) {
    await dependencies.resultSink({
      brief,
      contentItems: [
        ...builderItems,
        ...githubItems,
        ...editorialDrops,
        ...filtered.dropped,
        ...duplicates,
      ],
    });
  }
  return brief;
}

export function defaultDataDirectory(): string {
  return path.resolve(process.cwd(), "data");
}
