import {
  contentItems,
  createDatabase,
  migrate,
  models,
  pipelineRuns,
  providers,
} from "@morning-brief/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { TaskRunner } from "../src/runner.js";

describe("admin API", () => {
  let setup: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    setup = createDatabase(":memory:");
    await migrate(setup.client);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setup.client.close();
  });

  it("reports health and dashboard content counts", async () => {
    await setup.db
      .insert(contentItems)
      .values({
        id: "item-1",
        sourceType: "zara-x",
        sourceName: "Zara",
        content: "Agent update",
        url: "https://example.com/item",
        collectedAt: "2026-07-21T01:00:00.000Z",
        status: "kept",
      })
      .run();
    const app = createApp({
      db: setup.db,
      now: () => new Date("2026-07-21T08:00:00.000Z"),
    });
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect((await health.json()).database).toBe(true);
    const response = await app.request("/api/dashboard");
    const dashboard = await response.json();
    expect(dashboard.content.kept).toBe(1);
    expect(dashboard.service.components).toMatchObject({ api: true, database: true });
  });

  it("reports an active pipeline as running", async () => {
    vi.stubEnv("AUTOMATION_ENABLED", "true");
    vi.stubEnv("DAILY_SCHEDULE_INSTALLED", "true");
    vi.stubEnv("DAILY_COLLECTION_TIME", "06:50");
    await setup.db.insert(pipelineRuns).values({
      id: "run-active",
      taskName: "daily",
      status: "running",
      requestedBy: "schedule",
      startedAt: "2026-07-21T06:50:00.000Z",
      createdAt: "2026-07-21T06:50:00.000Z",
      updatedAt: "2026-07-21T06:50:00.000Z",
    }).run();
    const app = createApp({
      db: setup.db,
      now: () => new Date("2026-07-21T08:00:00.000Z"),
    });
    const response = await app.request("/api/dashboard");
    expect((await response.json()).service.status).toBe("running");
  });

  it("updates a content review decision", async () => {
    await setup.db
      .insert(contentItems)
      .values({
        id: "item-1",
        sourceType: "zara-x",
        sourceName: "Zara",
        content: "Football",
        url: "https://example.com/item",
        collectedAt: "2026-07-21T01:00:00.000Z",
      })
      .run();
    const app = createApp({ db: setup.db });
    const response = await app.request("/api/content/item-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "dropped",
        decisionReason: "not related to AI",
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("dropped");
  });

  it("rejects plaintext API keys", async () => {
    const app = createApp({ db: setup.db });
    const response = await app.request("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "unsafe",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        secretEnvRef: "SAFE_KEY",
        apiKey: "plaintext-secret",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("creates provider, model and task route configuration", async () => {
    await setup.db
      .insert(providers)
      .values({
        id: "provider-1",
        name: "proxy",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        secretEnvRef: "PROXY_KEY",
      })
      .run();
    await setup.db
      .insert(models)
      .values({
        id: "model-1",
        providerId: "provider-1",
        modelId: "fast",
        displayName: "Fast",
      })
      .run();
    const app = createApp({ db: setup.db });
    const response = await app.request("/api/task-routes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskKind: "filter",
        primaryModelId: "model-1",
        timeoutMs: 10000,
        maxRetries: 1,
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).taskKind).toBe("filter");
  });

  it("records and injects task triggers", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const runner: TaskRunner = { enqueue };
    const app = createApp({ db: setup.db, runner });
    const response = await app.request("/api/tasks/daily/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { date: "2026-07-21" } }),
    });
    expect(response.status).toBe(202);
    const data = await response.json();
    expect(data.status).toBe("queued");
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: "daily", runId: data.runId }),
    );
  });
});
