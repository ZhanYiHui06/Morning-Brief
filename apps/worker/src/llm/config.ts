import {
  createDatabase,
  decryptSecret,
  models,
  providerSecrets,
  providers,
  readMasterKey,
  taskRoutes,
} from "@morning-brief/database";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  LlmHttpError,
  OpenAiCompatibleLlm,
  type StructuredLlm,
} from "./adapter.js";

export interface RoutedLlm {
  llm: StructuredLlm;
  close: () => void;
}

interface RouteCandidate {
  role: "primary" | "fallback";
  modelId: string;
  llm: StructuredLlm;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  // Rate limits and server failures are transient. Network/timeout, malformed
  // JSON, and schema-validation failures are also safe to retry because each
  // generation request is side-effect free.
  if (!(error instanceof LlmHttpError)) return true;
  return error.status === 429 || error.status >= 500;
}

async function waitBeforeRetry(error: unknown, attempt: number): Promise<void> {
  if (!(error instanceof LlmHttpError) || error.status !== 429) return;
  const delayMs = Math.min(error.retryAfterMs ?? 1_000 * 2 ** (attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class RetryingFallbackLlm implements StructuredLlm {
  constructor(
    private readonly candidates: RouteCandidate[],
    private readonly maxRetries: number,
  ) {}

  async generate<T>(
    prompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options?: { system?: string; temperature?: number },
  ): Promise<T> {
    const failures: string[] = [];
    for (const candidate of this.candidates) {
      const attempts = candidate.role === "primary" ? this.maxRetries + 1 : 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await candidate.llm.generate<T>(prompt, schema, options);
        } catch (error) {
          failures.push(
            `${candidate.role} model ${candidate.modelId} attempt ${attempt}/${attempts}: ${errorMessage(error)}`,
          );
          if (!isRetryable(error)) break;
          if (attempt < attempts) await waitBeforeRetry(error, attempt);
        }
      }
    }
    throw new Error(`All configured LLM routes failed. ${failures.join(" | ")}`);
  }
}

export interface LoadRoutedLlmOptions {
  fetcher?: typeof fetch;
}

/**
 * Resolve an enabled model route configured through the admin API.
 *
 * Secrets may come from the legacy environment-variable reference or from the
 * encrypted Provider secret stored by the admin API.
 */
export async function loadRoutedLlm(
  taskKind: string,
  databaseUrl = process.env.DATABASE_URL,
  options: LoadRoutedLlmOptions = {},
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

    const candidates: RouteCandidate[] = [];
    const unusable: string[] = [];
    const configuredModels = [
      { role: "primary" as const, modelId: route.primaryModelId },
      ...(route.fallbackModelId
        ? [{ role: "fallback" as const, modelId: route.fallbackModelId }]
        : []),
    ];
    for (const configured of configuredModels) {
      const { role, modelId } = configured;
      const row = await db
        .select({
          modelId: models.modelId,
          modelEnabled: models.enabled,
          baseUrl: providers.baseUrl,
          protocol: providers.protocol,
          providerEnabled: providers.enabled,
          secretEnvRef: providers.secretEnvRef,
          encryptedCiphertext: providerSecrets.ciphertext,
          encryptedIv: providerSecrets.iv,
          encryptedAuthTag: providerSecrets.authTag,
        })
        .from(models)
        .innerJoin(providers, eq(models.providerId, providers.id))
        .leftJoin(providerSecrets, eq(providers.id, providerSecrets.providerId))
        .where(eq(models.id, modelId))
        .get();
      if (!row) {
        unusable.push(`${role} model ${modelId} does not exist`);
        continue;
      }
      if (!row.modelEnabled) {
        unusable.push(`${role} model ${modelId} is disabled`);
        continue;
      }
      if (!row.providerEnabled) {
        unusable.push(`${role} model ${modelId} has a disabled provider`);
        continue;
      }
      if (row.protocol !== "openai-compatible") {
        unusable.push(`${role} model ${modelId} uses unsupported protocol ${row.protocol}`);
        continue;
      }
      let apiKey = process.env[row.secretEnvRef];
      if (row.encryptedCiphertext && row.encryptedIv && row.encryptedAuthTag) {
        const masterKey = readMasterKey();
        if (!masterKey) {
          unusable.push(`${role} model ${modelId} requires MORNING_BRIEF_MASTER_KEY`);
          continue;
        }
        try {
          apiKey = decryptSecret({
            ciphertext: row.encryptedCiphertext,
            iv: row.encryptedIv,
            authTag: row.encryptedAuthTag,
          }, masterKey);
        } catch (error) {
          unusable.push(`${role} model ${modelId} secret decryption failed: ${errorMessage(error)}`);
          continue;
        }
      }
      if (!apiKey) {
        unusable.push(`${role} model ${modelId} has no configured API key`);
        continue;
      }
      candidates.push({
        role,
        modelId,
        llm: new OpenAiCompatibleLlm({
          baseUrl: row.baseUrl,
          apiKey,
          model: row.modelId,
          timeoutMs: route.timeoutMs,
          ...(options.fetcher ? { fetcher: options.fetcher } : {}),
        }),
      });
    }

    if (candidates.length === 0) {
      throw new Error(
        `No usable LLM route for ${taskKind}. ${unusable.join("; ")}`,
      );
    }
    return {
      llm: new RetryingFallbackLlm(candidates, route.maxRetries),
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
