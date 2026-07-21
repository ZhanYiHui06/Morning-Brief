import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BriefStatus = "complete" | "partial" | "fallback";

export interface OriginalSource {
  id?: string;
  author?: string;
  source: string;
  content: string;
  translatedContent?: string;
  url?: string;
  publishedAt?: string;
}

export interface LinkItem {
  title: string;
  summary: string;
  url?: string;
  source?: string;
  author?: string;
  category?: string;
  score?: number;
  reason?: string;
  originalSources?: OriginalSource[];
}

export interface TopicGroup {
  title: string;
  summary?: string;
  items: LinkItem[];
}

export interface GithubEntry extends LinkItem {
  rank: number;
  fullName: string;
  language?: string;
  starsToday?: number;
  totalStars?: number;
}

export interface RawSourceItem {
  id: string;
  sourceType: "zara-x" | "zara-podcast" | "zara-blog" | "github-trending";
  sourceName: string;
  author?: string;
  title?: string;
  content: string;
  url: string;
  publishedAt?: string;
  collectedAt?: string;
}

export interface DailyBrief {
  date: string;
  generatedAt?: string;
  status: BriefStatus;
  title: string;
  deck?: string;
  highlights: LinkItem[];
  builderTopics: TopicGroup[];
  githubTrending: GithubEntry[];
  suggestedActions: string[];
  warnings: string[];
  sourceStats?: {
    collected?: number;
    kept?: number;
    dropped?: number;
    merged?: number;
  };
  rawItems: RawSourceItem[];
}

const configuredDirectory = process.env.BRIEFS_DIR?.trim();
export const briefsDirectory = resolve(
  configuredDirectory || fileURLToPath(new URL("../../../../data/briefs", import.meta.url))
);

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function linkItem(value: unknown): LinkItem {
  const item = record(value);
  return {
    title: text(item.title, text(item.sourceName, "未命名条目")),
    summary: text(item.summary, text(item.content, "暂无摘要")),
    url: text(item.url) || undefined,
    source: text(item.source) || undefined,
    author: text(item.author) || undefined,
    category: text(item.category) || undefined,
    score: number(item.score ?? item.relevanceScore),
    reason: text(item.reason ?? item.relevanceReason ?? item.whyItMatters) || undefined,
    originalSources: list(item.sourceItems ?? item.originalSources).map((value) => {
      const source = record(value);
      return {
        id: text(source.id) || undefined,
        author: text(source.author) || undefined,
        source: text(source.sourceName ?? source.source, "未知来源"),
        content: text(source.content),
        translatedContent: text(source.translatedContent) || undefined,
        url: text(source.url) || undefined,
        publishedAt: text(source.publishedAt) || undefined
      };
    }).filter((source) => source.content)
  };
}

function normalizeBrief(value: unknown, filename: string): DailyBrief {
  const data = record(value);
  const date = text(data.date, filename.replace(/\.json$/i, ""));
  const statusValue = text(data.status);
  const status: BriefStatus =
    statusValue === "partial" || statusValue === "fallback" ? statusValue : "complete";

  return {
    date,
    generatedAt: text(data.generatedAt) || undefined,
    status,
    title: text(data.title, `${formatDate(date)} · AI 晨报`),
    deck: text(data.deck ?? data.overview) || undefined,
    highlights: list(data.highlights).map(linkItem),
    builderTopics: list(data.builderTopics).map((value) => {
      const topic = record(value);
      return {
        title: text(topic.title, "未分类"),
        summary: text(topic.summary) || undefined,
        items: list(topic.items ?? topic.entries).map(linkItem)
      };
    }),
    githubTrending: list(data.githubTrending).map((value, index) => {
      const item = record(value);
      const parsed = linkItem(value);
      return {
        ...parsed,
        rank: number(item.rank) ?? index + 1,
        fullName: text(item.fullName, parsed.title),
        language: text(item.language) || undefined,
        starsToday: number(item.starsToday),
        totalStars: number(item.totalStars)
      };
    }),
    suggestedActions: list(data.suggestedActions)
      .map((item) => (typeof item === "string" ? item : text(record(item).title)))
      .filter(Boolean),
    warnings: list(data.warnings).map((item) => text(item)).filter(Boolean),
    sourceStats: data.sourceStats ? {
      collected: number(record(data.sourceStats).collected),
      kept: number(record(data.sourceStats).kept),
      dropped: number(record(data.sourceStats).dropped),
      merged: number(record(data.sourceStats).merged)
    } : undefined,
    rawItems: list(data.rawItems).map((value) => {
      const item = record(value);
      return {
        id: text(item.id),
        sourceType: text(item.sourceType) as RawSourceItem["sourceType"],
        sourceName: text(item.sourceName, "未知来源"),
        author: text(item.author) || undefined,
        title: text(item.title) || undefined,
        content: text(item.content),
        url: text(item.url),
        publishedAt: text(item.publishedAt) || undefined,
        collectedAt: text(item.collectedAt) || undefined
      };
    }).filter((item) => item.id && item.url)
  };
}

export function loadBriefs(): DailyBrief[] {
  if (!existsSync(briefsDirectory)) return [];

  return readdirSync(briefsDirectory)
    .filter((filename) => /^\d{4}-\d{2}-\d{2}\.json$/.test(filename))
    .flatMap((filename) => {
      try {
        const raw = readFileSync(resolve(briefsDirectory, filename), "utf8");
        return [normalizeBrief(JSON.parse(raw), filename)];
      } catch (error) {
        console.warn(`[briefs] skipped invalid file ${filename}`, error);
        return [];
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  const parsed = new Date(`${date}T12:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("zh-CN", options ?? {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(parsed);
}

export function formatTime(value?: string) {
  if (!value) return "生成时间未知";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}
