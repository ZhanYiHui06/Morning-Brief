import { z } from "zod";
import type { SourceType } from "../schemas.js";

function assertJsonValue(value: unknown, path = "$"): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Invalid JSON value at ${path}`);
}

export interface ZaraFeedSource {
  name: string;
  type: Extract<SourceType, "zara-x" | "zara-podcast" | "zara-blog">;
  url: string;
}

export interface ZaraFeedSnapshot {
  source: ZaraFeedSource;
  collectedAt: string;
  payload: unknown;
}

export interface ZaraCollectorOptions {
  sources: ZaraFeedSource[];
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

const zaraFeedSourceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["zara-x", "zara-podcast", "zara-blog"]),
  url: z.string().url(),
});

export async function collectZaraFeeds(
  options: ZaraCollectorOptions,
): Promise<ZaraFeedSnapshot[]> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const now = options.now ?? (() => new Date());

  const sources = z.array(zaraFeedSourceSchema).parse(options.sources);
  return Promise.all(
    sources.map(async (source) => {
      const response = await fetcher(source.url, {
        headers: {
          accept: "application/json",
          "user-agent": "MorningBriefBot/0.1",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(
          `Zara feed "${source.name}" request failed: HTTP ${response.status}`,
        );
      }

      const payload: unknown = await response.json();
      assertJsonValue(payload);
      return {
        source,
        collectedAt: now().toISOString(),
        payload,
      };
    }),
  );
}
