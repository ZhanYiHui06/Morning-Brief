import type { ContentCluster } from "./cluster.js";
import {
  dailyBriefSchema,
  llmGeneratedContentSchema,
  llmBriefContentSchema,
  translationResultSchema,
  type DailyBrief,
  type ContentItem,
  type GitHubRepository,
  type LlmBriefContent,
} from "../schemas.js";
import type { StructuredLlm } from "../llm/adapter.js";

function plainSummary(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 1)}…`;
}

function needsChineseTranslation(value: string): boolean {
  const han = value.match(/\p{Script=Han}/gu)?.length ?? 0;
  const nonHanLetters = value.match(/[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  return nonHanLetters > 0 && han < nonHanLetters;
}

function splitForTranslation(value: string, maxCharacters = 6_000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + maxCharacters, value.length);
    if (end < value.length) {
      const newline = value.lastIndexOf("\n", end);
      const space = value.lastIndexOf(" ", end);
      const boundary = Math.max(newline, space);
      if (boundary > start + maxCharacters * 0.6) end = boundary;
    }
    chunks.push(value.slice(start, end).trim());
    start = end;
    while (/\s/.test(value[start] ?? "")) start += 1;
  }
  return chunks.filter(Boolean);
}

async function translateToChinese(
  content: string,
  llm: StructuredLlm,
): Promise<string> {
  const translatedChunks: string[] = [];
  for (const [index, chunk] of splitForTranslation(content).entries()) {
    const result = await llm.generate<{ translatedContent: string }>(
      [
        "将以下 Builder 原文忠实翻译成简体中文。",
        "不得概括、删减或增加观点；保留人名、产品名、链接、语气和段落结构。",
        `这是第 ${index + 1} 个连续片段，只返回该片段的完整翻译。`,
        "严格返回 JSON 对象，格式为：{\"translatedContent\":\"完整中文翻译\"}。不要使用其他字段名。",
        "原文：",
        chunk,
      ].join("\n"),
      translationResultSchema,
      { temperature: 0 },
    );
    translatedChunks.push(result.translatedContent.trim());
  }
  return translatedChunks.join("\n\n");
}

function fallbackContent(
  clusters: ContentCluster[],
  repositories: GitHubRepository[],
): LlmBriefContent {
  const entries = clusters
    .map((cluster) => {
      const lead = cluster.items[0];
      if (!lead) return null;
      return {
        id: cluster.id,
        title: lead.title ?? lead.author ?? lead.sourceName,
        summary: plainSummary(lead.content),
        whyItMatters: lead.decisionReason ?? "内容与 AI 产品或开发生态相关。",
        url: lead.url,
        sourceItemIds: cluster.items.map((item) => item.id),
        sourceNames: [...new Set(cluster.items.map((item) => item.sourceName))],
        sourceItems: cluster.items.map((item) => ({
          id: item.id,
          ...(item.author ? { author: item.author } : {}),
          sourceName: item.sourceName,
          content: item.content,
          url: item.url,
          ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        })),
        score: lead.totalScore ?? 5,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    title: entries[0]?.title ?? "今日 AI 产品与开发者动态",
    deck: entries.length > 0
      ? `今天从 ${entries.length} 组 Builder 动态中，提炼出值得关注的产品、工程与行业变化。`
      : "今天暂未发现足够明确的 Builder 信号，保留 GitHub 趋势供快速浏览。",
    highlights: entries.slice(0, 3),
    builderTopics:
      entries.length > 0
        ? [
            {
              id: "builders",
              title: "Builders 在说什么",
              entries,
            },
          ]
        : [],
    githubTrending: repositories.slice(0, 5).map((repository) => ({
      ...repository,
      summary: plainSummary(repository.description ?? repository.readme ?? ""),
      category: "开发者工具",
      relevance: "medium" as const,
      relevanceReason: "进入 GitHub Daily Trending 前五，值得快速浏览。",
    })),
    suggestedActions: entries[0]
      ? [`阅读「${entries[0].title}」的原始内容并判断是否需要跟进。`]
      : [],
  };
}

export async function generateDailyBrief(input: {
  date: string;
  clusters: ContentCluster[];
  githubRepositories: GitHubRepository[];
  collected: number;
  kept: number;
  dropped: number;
  merged: number;
  rawItems: ContentItem[];
  warnings?: string[];
  now?: () => Date;
  llm?: StructuredLlm;
}): Promise<DailyBrief> {
  let content: LlmBriefContent = fallbackContent(
    input.clusters,
    input.githubRepositories,
  );
  let status: DailyBrief["status"] =
    (input.warnings?.length ?? 0) > 0 ? "partial" : "complete";
  const warnings = [...(input.warnings ?? [])];

  if (input.llm) {
    const prompt = [
      "生成一份面向 AI 产品经理的中文晨报，忠于输入，不得臆测。",
      "生成一个总结当天共同信号的中文主标题和一段导语。标题应具体、自然，建议 12～24 个汉字；不要包含日期、Morning Brief、每日晨报等模板词。导语用 1～2 句话说明今天最值得注意的变化。",
      "保持 highlights<=3、githubTrending<=5、suggestedActions<=2。",
      "builderTopics 必须覆盖输入 clusters 中的每一个 sourceItemId，不能省略；可按主题分组，但同一个 sourceItemId 只出现一次。",
      "highlights 是跨来源的事件级编辑结论；builderTopics 只组织 Follow Builders 的人物观点。builderTopics 必须保留正确的 sourceItemIds，原始正文会在生成后由系统注入，不得自行改写原文。",
      "严格返回一个 JSON 对象，不要使用字符串代替对象。结构必须是：",
      JSON.stringify({
        title: "总结当天共同信号的标题",
        deck: "概括今日主要变化及其意义的导语",
        highlights: [{ id: "event-id", title: "标题", summary: "概括", whyItMatters: "价值", url: null, sourceItemIds: ["source-id"] }],
        builderTopics: [{ id: "topic-id", title: "主题", entries: [{ id: "event-id", title: "标题", summary: "概括", whyItMatters: "价值", url: null, sourceItemIds: ["source-id"] }] }],
        githubTrending: [{ fullName: "owner/repo", summary: "中文介绍", category: "类别", relevance: "high", relevanceReason: "相关性原因" }],
        suggestedActions: ["下一步行动"],
      }),
      "githubTrending 只返回上述五个字段，fullName 必须与输入仓库完全一致；仓库排名、Star、语言等字段由系统合并。",
      "输入 JSON：",
      JSON.stringify({
        clusters: input.clusters,
        githubRepositories: input.githubRepositories,
      }),
    ].join("\n");
    try {
      const generated = await input.llm.generate(
        prompt,
        llmGeneratedContentSchema,
      );
      const summaries = new Map(generated.githubTrending.map((item) => [item.fullName, item]));
      content = llmBriefContentSchema.parse({
        ...generated,
        githubTrending: input.githubRepositories.slice(0, 5).map((repository) => ({
          ...repository,
          ...(summaries.get(repository.fullName) ?? {
            summary: plainSummary(repository.description ?? repository.readme ?? ""),
            category: "开发者工具",
            relevance: "medium" as const,
            relevanceReason: "进入 GitHub Daily Trending 前五，值得快速浏览。",
          }),
        })),
      });
    } catch (error) {
      status = "fallback";
      warnings.push(
        `LLM generation failed; deterministic fallback used: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    status = "fallback";
    warnings.push("No LLM configured; deterministic fallback used");
  }

  const sourceItemsById = new Map(
    input.clusters.flatMap((cluster) => cluster.items).map((item) => [item.id, item]),
  );
  const clustersById = new Map(input.clusters.map((cluster) => [cluster.id, cluster]));
  let builderTopics = content.builderTopics.map((topic) => ({
    ...topic,
    entries: topic.entries.map((entry) => {
      const referencedItems = entry.sourceItemIds
        .map((id) => sourceItemsById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const originalItems = referencedItems.length > 0
        ? referencedItems
        : (clustersById.get(entry.id)?.items ?? []);
      return {
        ...entry,
        sourceItemIds: originalItems.map((item) => item.id),
        sourceNames: [...new Set(originalItems.map((item) => item.sourceName))],
        sourceItems: originalItems.map((item) => ({
          id: item.id,
          ...(item.author ? { author: item.author } : {}),
          sourceName: item.sourceName,
          content: item.content,
          url: item.url,
          ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        })),
      };
    }),
  }));

  const referencedSourceIds = new Set(
    builderTopics
      .flatMap((topic) => topic.entries)
      .flatMap((entry) => entry.sourceItemIds),
  );
  const missingSources = [...sourceItemsById.values()].filter(
    (item) => !referencedSourceIds.has(item.id),
  );
  if (missingSources.length > 0) {
    builderTopics.push({
      id: "more-builders",
      title: "更多 Builder 动态",
      entries: missingSources.map((item) => ({
        id: item.eventId ?? item.id,
        title: item.title ?? item.author ?? item.sourceName,
        summary: plainSummary(item.content),
        whyItMatters: item.decisionReason ?? "进入今日 Builder 入选列表。",
        url: item.url,
        sourceItemIds: [item.id],
        sourceNames: [item.sourceName],
        sourceItems: [{
          id: item.id,
          ...(item.author ? { author: item.author } : {}),
          sourceName: item.sourceName,
          content: item.content,
          url: item.url,
          ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        }],
        score: item.totalScore ?? 5,
      })),
    });
  }

  if (input.llm) {
    const translatableSources = [
      ...new Map(
        builderTopics
          .flatMap((topic) => topic.entries)
          .flatMap((entry) => entry.sourceItems ?? [])
          .filter((source) => needsChineseTranslation(source.content))
          .map((source) => [source.id, source]),
      ).values(),
    ];
    const translations = new Map<string, string>();
    let nextTranslation = 0;
    const translateWorker = async () => {
      while (nextTranslation < translatableSources.length) {
        const source = translatableSources[nextTranslation++];
        if (!source) return;
        try {
          translations.set(
            source.id,
            await translateToChinese(source.content, input.llm!),
          );
        } catch (error) {
          if (status === "complete") status = "partial";
          warnings.push(
            `Translation failed for ${source.id}; original content preserved: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, translatableSources.length) }, translateWorker),
    );
    builderTopics = builderTopics.map((topic) => ({
      ...topic,
      entries: topic.entries.map((entry) => ({
        ...entry,
        sourceItems: entry.sourceItems?.map((source) => ({
          ...source,
          ...(translations.has(source.id)
            ? { translatedContent: translations.get(source.id) }
            : {}),
        })),
      })),
    }));
  }

  return dailyBriefSchema.parse({
    id: `brief:${input.date}`,
    date: input.date,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    status,
    ...content,
    builderTopics,
    warnings,
    sourceStats: {
      collected: input.collected,
      kept: input.kept,
      dropped: input.dropped,
      merged: input.merged,
    },
    rawItems: input.rawItems.map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      sourceName: item.sourceName,
      ...(item.author ? { author: item.author } : {}),
      ...(item.title ? { title: item.title } : {}),
      content: item.content,
      url: item.url,
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      collectedAt: item.collectedAt,
    })),
  });
}
