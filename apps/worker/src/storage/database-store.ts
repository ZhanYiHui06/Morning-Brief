import {
  contentItems,
  createDatabase,
  dailyBriefs,
  migrate,
} from "@morning-brief/database";
import type { DailyRunResult } from "../run-daily.js";

export function createDatabaseResultSink(databaseUrl: string) {
  const { db, client } = createDatabase(databaseUrl);

  return {
    async initialize() {
      await migrate(client);
    },
    async persist({ brief, contentItems: items }: DailyRunResult) {
      for (const item of items) {
        const values = {
          id: item.id,
          sourceType: item.sourceType,
          sourceName: item.sourceName,
          externalId: item.externalId ?? null,
          author: item.author ?? null,
          title: item.title ?? null,
          content: item.content,
          url: item.url,
          publishedAt: item.publishedAt ?? null,
          collectedAt: item.collectedAt,
          category: item.category ?? null,
          relevanceScore: item.relevanceScore ?? null,
          importanceScore: item.importanceScore ?? null,
          noveltyScore: item.noveltyScore ?? null,
          actionabilityScore: item.actionabilityScore ?? null,
          status: item.status,
          decisionReason: item.decisionReason ?? null,
          eventId: item.eventId ?? null,
          fingerprint: item.fingerprint,
          rawJson: item.raw === undefined ? null : JSON.stringify(item.raw),
          updatedAt: new Date().toISOString(),
        };
        await db.insert(contentItems)
          .values(values)
          .onConflictDoUpdate({ target: contentItems.fingerprint, set: values })
          .run();
      }

      const briefValues = {
        id: brief.id,
        date: brief.date,
        status: brief.status,
        title: brief.title,
        generatedAt: brief.generatedAt,
        payloadJson: JSON.stringify(brief),
        updatedAt: new Date().toISOString(),
      };
      await db.insert(dailyBriefs)
        .values(briefValues)
        .onConflictDoUpdate({ target: dailyBriefs.date, set: briefValues })
        .run();
    },
    close() {
      client.close();
    },
  };
}
