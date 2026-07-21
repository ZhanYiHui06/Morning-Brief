import {
  contentItems,
  createDatabase,
  migrate,
  models,
  pipelineRuns,
  providers,
} from "@morning-brief/database";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import type { TaskRunner } from "../src/runner.js";

const resolvePublicHostname = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

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
    const app = createApp({ db: setup.db, resolveHostname: resolvePublicHostname });
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

  it("requires a master key before accepting an API key", async () => {
    const app = createApp({ db: setup.db, resolveHostname: resolvePublicHostname });
    const response = await app.request("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "unsafe",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "plaintext-secret",
      }),
    });
    expect(response.status).toBe(503);
  });

  it("stores API keys encrypted and never returns secret material", async () => {
    vi.stubEnv("MORNING_BRIEF_MASTER_KEY", Buffer.alloc(32, 3).toString("base64"));
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "brief-model" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const app = createApp({ db: setup.db, fetchImpl, resolveHostname: resolvePublicHostname });
    const response = await app.request("/api/providers", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({
        name: "secure", protocol: "openai-compatible", baseUrl: "https://example.com/v1",
        apiKey: "plaintext-secret",
      }) });
    expect(response.status).toBe(201);
    const provider = await response.json();
    expect(provider.keyConfigured).toBe(true);
    expect(JSON.stringify(provider)).not.toContain("plaintext-secret");
    expect(JSON.stringify(provider)).not.toContain("ciphertext");
    const test = await app.request(`/api/providers/${provider.id}/test`, { method: "POST" });
    expect(test.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer plaintext-secret" }) }));
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

  it("saves model configuration atomically and protects primary route models", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "morning-brief-model-config-"));
    const configSetup = createDatabase(path.join(directory, "config.sqlite"));
    onTestFinished(async () => {
      await configSetup.client.close();
      try {
        await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      }
    });
    await migrate(configSetup.client);
    await configSetup.db.insert(providers).values({
      id: "provider-config",
      name: "Before",
      protocol: "openai-compatible",
      baseUrl: "https://example.com/v1",
      secretEnvRef: "CONFIG_KEY",
    }).run();
    await configSetup.db.insert(models).values({
      id: "model-config",
      providerId: "provider-config",
      modelId: "brief-v1",
      displayName: "Before model",
      enabled: true,
    }).run();
    const app = createApp({ db: configSetup.db, resolveHostname: resolvePublicHostname });
    const config = {
      paused: false,
      providers: [{
        id: "provider-config",
        name: "After",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        enabled: true,
      }],
      models: [{
        id: "model-config",
        providerId: "provider-config",
        modelId: "brief-v1",
        displayName: "After model",
        enabled: true,
        structuredOutput: true,
      }],
      routes: [{ task: "daily-overview", primaryModelId: "model-config" }],
    };
    const saved = await app.request("/api/model-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(200);
    expect(await configSetup.db.select().from(providers).where(eq(providers.id, "provider-config")).get())
      .toMatchObject({ name: "After" });

    const invalid = await app.request("/api/model-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...config,
        providers: [{ ...config.providers[0], name: "Must roll back" }],
        routes: [{ task: "daily-overview", primaryModelId: "missing-model" }],
      }),
    });
    expect(invalid.status).toBe(409);
    expect(await configSetup.db.select().from(providers).where(eq(providers.id, "provider-config")).get())
      .toMatchObject({ name: "After" });

    const deleting = await app.request("/api/models/model-config", { method: "DELETE" });
    expect(deleting.status).toBe(409);
    expect(await deleting.json()).toMatchObject({ error: "model_in_use", taskKinds: ["daily-overview"] });
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

  it("requires configured admin credentials while leaving health public", async () => {
    const app = createApp({
      db: setup.db,
      adminCredentials: { username: "operator", password: "correct horse battery staple" },
    });
    expect((await app.request("/health")).status).toBe(200);
    const unauthorized = await app.request("/api/dashboard");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("Basic");
    const authorization = `Basic ${Buffer.from("operator:correct horse battery staple").toString("base64")}`;
    expect((await app.request("/api/dashboard", { headers: { authorization } })).status).toBe(200);
  });

  it("rejects cross-site state changes even with valid credentials", async () => {
    const authorization = `Basic ${Buffer.from("operator:secret").toString("base64")}`;
    const app = createApp({
      db: setup.db,
      adminCredentials: { username: "operator", password: "secret" },
    });
    const response = await app.request("/api/tasks/daily/trigger", {
      method: "POST",
      headers: { authorization, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects HTTP, loopback, and DNS-resolved private Provider URLs", async () => {
    const createProvider = (baseUrl: string, resolveHostname = resolvePublicHostname) => {
      const app = createApp({ db: setup.db, resolveHostname });
      return app.request("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "unsafe",
          protocol: "openai-compatible",
          baseUrl,
          secretEnvRef: "TEST_PROVIDER_KEY",
        }),
      });
    };
    expect((await createProvider("http://example.com/v1")).status).toBe(400);
    expect((await createProvider("https://127.0.0.1/v1")).status).toBe(400);
    const privateDns = vi.fn(async () => [{ address: "169.254.169.254", family: 4 }]);
    const response = await createProvider("https://metadata.example/v1", privateDns);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unsafe_provider_url", reason: "unsafe_destination" });
  });

  it("does not follow Provider redirects", async () => {
    vi.stubEnv("PROXY_KEY", "secret");
    await setup.db.insert(providers).values({
      id: "redirecting-provider",
      name: "redirecting",
      protocol: "openai-compatible",
      baseUrl: "https://example.com/v1",
      secretEnvRef: "PROXY_KEY",
    }).run();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
    }));
    const app = createApp({ db: setup.db, fetchImpl, resolveHostname: resolvePublicHostname });
    const response = await app.request("/api/providers/redirecting-provider/test", { method: "POST" });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, error: "unsafe_redirect" });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: "manual" }));
  });

  it("does not create a queued run when no runner is available", async () => {
    const app = createApp({ db: setup.db });
    const response = await app.request("/api/tasks/daily/trigger", { method: "POST" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "runner_unavailable" });
    expect(await setup.db.select().from(pipelineRuns).all()).toHaveLength(0);
  });
});
