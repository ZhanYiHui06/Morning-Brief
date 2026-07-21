import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDatabase,
  migrate,
  models,
  providers,
  taskRoutes,
} from "@morning-brief/database";
import { afterEach, describe, expect, it } from "vitest";
import { OpenAiCompatibleLlm } from "../src/llm/adapter.js";
import { loadRoutedLlm } from "../src/llm/config.js";

const createdDirectories: string[] = [];

afterEach(async () => {
  delete process.env.TEST_ROUTED_LLM_KEY;
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      }).catch((error: NodeJS.ErrnoException) => {
        // libSQL can release its Windows file handle after the Vitest worker
        // exits. A temporary fixture lock must not turn a passing assertion
        // into a product failure.
        if (process.platform !== "win32" || error.code !== "EBUSY") throw error;
      }),
    ),
  );
});

describe("loadRoutedLlm", () => {
  it("resolves the provider secret from its environment reference", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "morning-brief-route-"));
    createdDirectories.push(directory);
    const filename = path.join(directory, "config.sqlite");
    const { db, client } = createDatabase(filename);
    await migrate(client);
    await db.insert(providers).values({
      id: "provider",
      name: "Local proxy",
      protocol: "openai-compatible",
      baseUrl: "http://127.0.0.1:9999/v1",
      secretEnvRef: "TEST_ROUTED_LLM_KEY",
      enabled: true,
    });
    await db.insert(models).values({
      id: "model",
      providerId: "provider",
      modelId: "brief-model",
      displayName: "Brief model",
      enabled: true,
      supportsStructuredOutput: true,
    });
    await db.insert(taskRoutes).values({
      id: "route",
      taskKind: "daily-overview",
      primaryModelId: "model",
      timeoutMs: 30_000,
      maxRetries: 1,
    });
    client.close();

    process.env.TEST_ROUTED_LLM_KEY = "test-only-secret";
    const routed = await loadRoutedLlm("daily-overview", filename);

    expect(routed?.llm).toBeInstanceOf(OpenAiCompatibleLlm);
    routed?.close();
  });
});
