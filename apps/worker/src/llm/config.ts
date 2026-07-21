import {
  createDatabase,
  models,
  providers,
  taskRoutes,
} from "@morning-brief/database";
import { eq } from "drizzle-orm";
import { OpenAiCompatibleLlm, type StructuredLlm } from "./adapter.js";

export interface RoutedLlm {
  llm: StructuredLlm;
  close: () => void;
}

/**
 * Resolve an enabled model route configured through the admin API.
 *
 * Only the environment-variable reference is stored in SQLite. The secret is
 * read from the worker process at call time and never returned by an API.
 */
export async function loadRoutedLlm(
  taskKind: string,
  databaseUrl = process.env.DATABASE_URL,
): Promise<RoutedLlm | undefined> {
  if (!databaseUrl) return undefined;
  const { db, client } = createDatabase(databaseUrl);
  const close = () => client.close();

  try {
    const route = await db
      .select()
      .from(taskRoutes)
      .where(eq(taskRoutes.taskKind, taskKind))
      .get();
    if (!route) {
      close();
      return undefined;
    }

    for (const modelId of [
      route.primaryModelId,
      route.fallbackModelId,
    ].filter((value): value is string => Boolean(value))) {
      const row = await db
        .select({
          modelId: models.modelId,
          modelEnabled: models.enabled,
          baseUrl: providers.baseUrl,
          protocol: providers.protocol,
          providerEnabled: providers.enabled,
          secretEnvRef: providers.secretEnvRef,
        })
        .from(models)
        .innerJoin(providers, eq(models.providerId, providers.id))
        .where(eq(models.id, modelId))
        .get();
      if (
        !row ||
        !row.modelEnabled ||
        !row.providerEnabled ||
        row.protocol !== "openai-compatible"
      ) {
        continue;
      }
      const apiKey = process.env[row.secretEnvRef];
      if (!apiKey) continue;
      return {
        llm: new OpenAiCompatibleLlm({
          baseUrl: row.baseUrl,
          apiKey,
          model: row.modelId,
          timeoutMs: route.timeoutMs,
        }),
        close,
      };
    }

    close();
    return undefined;
  } catch {
    close();
    return undefined;
  }
}
