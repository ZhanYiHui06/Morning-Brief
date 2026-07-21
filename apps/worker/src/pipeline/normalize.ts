import { createHash } from "node:crypto";
import type { ZaraFeedSnapshot } from "../collectors/zara.js";
import {
  contentItemSchema,
  type ContentItem,
  type GitHubRepository,
} from "../schemas.js";

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function findRecords(payload: unknown, sourceType?: string): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    );
  }
  if (typeof payload !== "object" || payload === null) return [];
  const record = payload as Record<string, unknown>;
  if (sourceType === "zara-x" && Array.isArray(record.x)) {
    return record.x.flatMap((builder) => {
      if (!builder || typeof builder !== "object" || Array.isArray(builder)) return [];
      const profile = builder as Record<string, unknown>;
      if (!Array.isArray(profile.tweets)) return [];
      return profile.tweets.flatMap((tweet) => {
        if (!tweet || typeof tweet !== "object" || Array.isArray(tweet)) return [];
        return [{
          ...(tweet as Record<string, unknown>),
          author: firstString(profile, ["name", "handle"]),
          handle: firstString(profile, ["handle"]),
        }];
      });
    });
  }
  for (const key of ["items", "tweets", "posts", "episodes", "articles", "podcasts", "blogs", "data"]) {
    if (Array.isArray(record[key])) return findRecords(record[key], sourceType);
  }
  return [record];
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

export function createFingerprint(input: {
  sourceType: string;
  url?: string;
  author?: string;
  title?: string;
  content: string;
}): string {
  const canonicalUrl = input.url
    ? input.url.split("#")[0]?.replace(/\/$/, "").toLowerCase()
    : "";
  const normalized = [
    input.sourceType,
    canonicalUrl,
    input.author?.toLowerCase().trim() ?? "",
    input.title?.toLowerCase().replace(/\s+/g, " ").trim() ?? "",
    input.content.toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

export function normalizeZaraSnapshots(
  snapshots: ZaraFeedSnapshot[],
): ContentItem[] {
  const output: ContentItem[] = [];
  for (const snapshot of snapshots) {
    for (const record of findRecords(snapshot.payload, snapshot.source.type)) {
      const contentFields = snapshot.source.type === "zara-podcast"
        ? ["transcript", "content", "text", "description", "summary"]
        : ["content", "text", "transcript", "description", "summary"];
      const content =
        firstString(record, contentFields) ?? "";
      const title = firstString(record, ["title", "name"]);
      const author = firstString(record, [
        "author",
        "username",
        "handle",
        "creator",
      ]);
      const url =
        firstString(record, ["url", "link", "permalink", "tweetUrl"]) ??
        snapshot.source.url;
      const publishedAt = normalizeDate(
        firstString(record, [
          "publishedAt",
          "published_at",
          "createdAt",
          "created_at",
          "date",
        ]),
      );
      const externalId = firstString(record, ["id", "tweetId", "guid"]);
      const fingerprint = createFingerprint({
        sourceType: snapshot.source.type,
        url,
        ...(author ? { author } : {}),
        ...(title ? { title } : {}),
        content,
      });
      output.push(contentItemSchema.parse({
        id: externalId ? `${snapshot.source.type}:${externalId}` : fingerprint,
        fingerprint,
        sourceType: snapshot.source.type,
        sourceName: snapshot.source.name,
        ...(externalId ? { externalId } : {}),
        ...(author ? { author } : {}),
        ...(title ? { title } : {}),
        content,
        url,
        ...(publishedAt ? { publishedAt } : {}),
        collectedAt: snapshot.collectedAt,
        status: "pending",
        raw: record,
      }));
    }
  }
  return output;
}

export function normalizeGitHubRepositories(
  repositories: GitHubRepository[],
  collectedAt: string,
): ContentItem[] {
  return repositories.map((repository) => {
    const content = [
      repository.description ?? "",
      repository.readme?.slice(0, 10_000) ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const fingerprint = createFingerprint({
      sourceType: "github-trending",
      url: repository.url,
      title: repository.fullName,
      content,
    });
    return contentItemSchema.parse({
      id: fingerprint,
      fingerprint,
      sourceType: "github-trending",
      sourceName: "GitHub Trending",
      title: repository.fullName,
      content,
      url: repository.url,
      collectedAt,
      status: "pending",
      raw: repository,
    });
  });
}
