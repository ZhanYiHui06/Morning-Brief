import { pathToFileURL } from "node:url";
import { GitHubApiReadmeClient } from "../collectors/github-readme.js";
import { OpenAiCompatibleLlm } from "../llm/adapter.js";
import { loadRoutedLlm } from "../llm/config.js";
import { defaultDataDirectory, runDaily } from "../run-daily.js";
import { createDatabaseResultSink } from "../storage/database-store.js";

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.TZ ?? "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function parseSources() {
  const configured = process.env.ZARA_FEEDS_JSON;
  if (configured) {
    return JSON.parse(configured) as Array<{
      name: string;
      type: "zara-x" | "zara-podcast" | "zara-blog";
      url: string;
    }>;
  }
  const sources = [
    process.env.ZARA_X_FEED_URL
      ? {
          name: "Zara X",
          type: "zara-x" as const,
          url: process.env.ZARA_X_FEED_URL,
        }
      : null,
    process.env.ZARA_PODCASTS_FEED_URL
      ? {
          name: "Zara Podcasts",
          type: "zara-podcast" as const,
          url: process.env.ZARA_PODCASTS_FEED_URL,
        }
      : null,
    process.env.ZARA_BLOGS_FEED_URL
      ? {
          name: "Zara Blogs",
          type: "zara-blog" as const,
          url: process.env.ZARA_BLOGS_FEED_URL,
        }
      : null,
  ].filter((source): source is NonNullable<typeof source> => source !== null);
  if (sources.length === 0) {
    throw new Error(
      "Configure at least one Zara feed URL (ZARA_X_FEED_URL, ZARA_PODCASTS_FEED_URL or ZARA_BLOGS_FEED_URL)",
    );
  }
  return sources;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const dateFlag = argv.indexOf("--date");
  const date =
    dateFlag >= 0 && argv[dateFlag + 1]
      ? argv[dateFlag + 1]
      : localDate(new Date());
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("--date must use YYYY-MM-DD");
  }

  const llmBaseUrl = process.env.LLM_BASE_URL;
  const llmApiKey =
    process.env.MORNING_BRIEF_LLM_API_KEY ?? process.env.LLM_API_KEY;
  const llmModel = process.env.LLM_MODEL;
  const environmentLlm =
    llmBaseUrl && llmApiKey && llmModel
      ? new OpenAiCompatibleLlm({
          baseUrl: llmBaseUrl,
          apiKey: llmApiKey,
          model: llmModel,
        })
      : undefined;
  const routedLlm = await loadRoutedLlm("daily-overview");
  const llm = routedLlm?.llm ?? environmentLlm;
  const readmeClient = new GitHubApiReadmeClient({
    ...(process.env.GITHUB_TOKEN
      ? { token: process.env.GITHUB_TOKEN }
      : {}),
  });
  const databaseSink = process.env.DATABASE_URL
    ? createDatabaseResultSink(process.env.DATABASE_URL)
    : undefined;
  await databaseSink?.initialize();
  try {
    const brief = await runDaily(
      {
        date,
        dataDirectory:
          process.env.DATA_DIR ??
          process.env.DATA_DIRECTORY ??
          defaultDataDirectory(),
        zaraSources: parseSources(),
      },
      {
        readmeClient,
        ...(llm ? { llm } : {}),
        ...(databaseSink ? { resultSink: databaseSink.persist } : {}),
      },
    );
    process.stdout.write(
      `Generated ${brief.date} brief (${brief.status}): ${brief.highlights.length} highlights, ${brief.githubTrending.length} trending repositories\n`,
    );
  } finally {
    routedLlm?.close();
    databaseSink?.close();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Morning Brief failed: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  });
}
