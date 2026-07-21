import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDatabase,
  encryptSecret,
  migrate,
  models,
  providerSecrets,
  providers,
  taskRoutes,
} from "@morning-brief/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadRoutedLlm, RetryingFallbackLlm } from "../src/llm/config.js";

const createdDirectories: string[] = [];
const resultSchema = z.object({ result: z.string() });

afterEach(async () => {
  delete process.env.TEST_ROUTED_LLM_KEY;
  delete process.env.TEST_FALLBACK_LLM_KEY;
  delete process.env.MORNING_BRIEF_MASTER_KEY;
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      }).catch((error: NodeJS.ErrnoException) => {
        if (process.platform !== "win32" || error.code !== "EBUSY") throw error;
      }),
    ),
  );
});

function completion(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

async function createFixture(options: {
  encryptedPrimaryKey?: { value: string; key: Buffer };
  maxRetries?: number;
  fallback?: boolean;
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "morning-brief-route-"));
  createdDirectories.push(directory);
  const filename = path.join(directory, "config.sqlite");
  const { db, client } = createDatabase(filename);
  await migrate(client);
  await db.insert(providers).values({
    id: "primary-provider",
    name: "Primary",
    protocol: "openai-compatible",
    baseUrl: "https://primary.example/v1",
    secretEnvRef: "TEST_ROUTED_LLM_KEY",
    enabled: true,
  });
  await db.insert(models).values({
    id: "primary-model",
    providerId: "primary-provider",
    modelId: "primary-external",
    displayName: "Primary model",
    enabled: true,
    supportsStructuredOutput: true,
  });
  if (options.encryptedPrimaryKey) {
    await db.insert(providerSecrets).values({
      providerId: "primary-provider",
      ...encryptSecret(options.encryptedPrimaryKey.value, options.encryptedPrimaryKey.key),
    });
  }
  if (options.fallback) {
    await db.insert(providers).values({
      id: "fallback-provider",
      name: "Fallback",
      protocol: "openai-compatible",
      baseUrl: "https://fallback.example/v1",
      secretEnvRef: "TEST_FALLBACK_LLM_KEY",
      enabled: true,
    });
    await db.insert(models).values({
      id: "fallback-model",
      providerId: "fallback-provider",
      modelId: "fallback-external",
      displayName: "Fallback model",
      enabled: true,
      supportsStructuredOutput: true,
    });
  }
  await db.insert(taskRoutes).values({
    id: "route",
    taskKind: "daily-overview",
    primaryModelId: "primary-model",
    fallbackModelId: options.fallback ? "fallback-model" : null,
    timeoutMs: 30_000,
    maxRetries: options.maxRetries ?? 1,
  });
  client.close();
  return filename;
}

describe("loadRoutedLlm", () => {
  it("resolves a provider secret from its environment reference", async () => {
    const filename = await createFixture();
    process.env.TEST_ROUTED_LLM_KEY = "test-only-secret";
    const routed = await loadRoutedLlm("daily-overview", filename);
    expect(routed?.llm).toBeInstanceOf(RetryingFallbackLlm);
    routed?.close();
  });

  it("decrypts database provider secrets with MORNING_BRIEF_MASTER_KEY", async () => {
    const key = Buffer.alloc(32, 7);
    const filename = await createFixture({
      encryptedPrimaryKey: { value: "encrypted-secret", key },
    });
    process.env.MORNING_BRIEF_MASTER_KEY = key.toString("base64");
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer encrypted-secret");
      return completion('{"result":"ok"}');
    }) as unknown as typeof fetch;
    const routed = await loadRoutedLlm("daily-overview", filename, { fetcher });
    await expect(routed?.llm.generate("prompt", resultSchema)).resolves.toEqual({ result: "ok" });
    routed?.close();
  });

  it("accepts structured output returned in reasoning_content", async () => {
    const filename = await createFixture();
    process.env.TEST_ROUTED_LLM_KEY = "test-only-secret";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", reasoning_content: '{"result":"ok"}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const routed = await loadRoutedLlm("daily-overview", filename, { fetcher });
    await expect(routed?.llm.generate("prompt", resultSchema)).resolves.toEqual({ result: "ok" });
    routed?.close();
  });

  it("accepts array-form OpenAI content", async () => {
    const filename = await createFixture();
    process.env.TEST_ROUTED_LLM_KEY = "test-only-secret";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: '{"result":"ok"}' }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const routed = await loadRoutedLlm("daily-overview", filename, { fetcher });
    await expect(routed?.llm.generate("prompt", resultSchema)).resolves.toEqual({ result: "ok" });
    routed?.close();
  });

  it("retries HTTP 429 responses and honors a zero Retry-After", async () => {
    const filename = await createFixture({ maxRetries: 1 });
    process.env.TEST_ROUTED_LLM_KEY = "test-only-secret";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      }))
      .mockResolvedValueOnce(completion('{"result":"ok"}')) as unknown as typeof fetch;
    const routed = await loadRoutedLlm("daily-overview", filename, { fetcher });
    await expect(routed?.llm.generate("prompt", resultSchema)).resolves.toEqual({ result: "ok" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    routed?.close();
  });

  it("reports encrypted secrets with missing or wrong master keys", async () => {
    const key = Buffer.alloc(32, 8);
    const filename = await createFixture({ encryptedPrimaryKey: { value: "secret", key } });
    await expect(loadRoutedLlm("daily-overview", filename)).rejects.toThrow(
      /requires MORNING_BRIEF_MASTER_KEY/,
    );
    process.env.MORNING_BRIEF_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
    await expect(loadRoutedLlm("daily-overview", filename)).rejects.toThrow(
      /secret decryption failed/,
    );
  });

  it.each([
    {
      name: "HTTP 5xx",
      failure: () => completion("{}", 503),
    },
    {
      name: "timeout",
      failure: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    },
    {
      name: "invalid structured output",
      failure: () => completion("not-json"),
    },
  ])("retries primary $name failures, then switches to fallback", async ({ failure }) => {
    const filename = await createFixture({ fallback: true, maxRetries: 1 });
    process.env.TEST_ROUTED_LLM_KEY = "primary-key";
    process.env.TEST_FALLBACK_LLM_KEY = "fallback-key";
    const requestedModels: string[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      requestedModels.push(model);
      if (model === "primary-external") return await failure();
      return completion('{"result":"fallback-ok"}');
    }) as unknown as typeof fetch;
    const routed = await loadRoutedLlm("daily-overview", filename, { fetcher });
    await expect(routed?.llm.generate("prompt", resultSchema)).resolves.toEqual({
      result: "fallback-ok",
    });
    expect(requestedModels).toEqual([
      "primary-external",
      "primary-external",
      "fallback-external",
    ]);
    routed?.close();
  });

  it("surfaces every attempt when primary and fallback both fail", async () => {
    const filename = await createFixture({ fallback: true, maxRetries: 1 });
    process.env.TEST_ROUTED_LLM_KEY = "primary-key";
    process.env.TEST_FALLBACK_LLM_KEY = "fallback-key";
    const fetcher = vi.fn(async () => completion("{}", 503)) as unknown as typeof fetch;
    const routed = await loadRoutedLlm("daily-overview", filename, { fetcher });
    await expect(routed?.llm.generate("prompt", resultSchema)).rejects.toThrow(
      /primary model primary-model attempt 2\/2.*fallback model fallback-model attempt 1\/1/,
    );
    routed?.close();
  });
});
