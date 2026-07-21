import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig } from "./types";

const response = (status: number, body?: unknown) => new Response(
  body === undefined ? null : JSON.stringify(body),
  { status, headers: { "Content-Type": "application/json" } },
);

async function loadApi() {
  vi.resetModules();
  vi.stubEnv("VITE_ADMIN_API_URL", "http://admin.test/api");
  return import("./api");
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin API client", () => {
  it("reports a failed atomic configuration save without fallback writes", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(response(500, { error: "broken" }));
    const { api, ApiError } = await loadApi();
    const config: ModelConfig = {
      paused: false,
      providers: [{ id: "provider-1", name: "Primary", protocol: "openai-compatible", baseUrl: "https://example.com/v1", enabled: true, health: "unknown", keyConfigured: true, modelCount: 0 }],
      models: [],
      routes: [],
    };

    await expect(api.saveModelConfig(config)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://admin.test/api/model-config");
  });

  it("saves providers, models, and routes through one transaction endpoint", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(response(200, {}));
    const { api } = await loadApi();
    await api.saveModelConfig({
      paused: false,
      providers: [],
      models: [],
      routes: [{ task: "daily-overview", label: "Daily", primaryModelId: "model-1" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://admin.test/api/model-config");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      routes: [{ task: "daily-overview", primaryModelId: "model-1" }],
    });
  });

  it("maps finished runs to a real duration and a visible stage", async () => {
    vi.mocked(fetch).mockResolvedValue(response(200, { items: [{
      id: "run-1",
      taskName: "daily",
      status: "succeeded",
      requestedBy: "manual",
      startedAt: "2026-07-21T00:00:00.000Z",
      finishedAt: "2026-07-21T00:00:02.500Z",
    }] }));
    const { api } = await loadApi();

    await expect(api.runs()).resolves.toMatchObject([{ durationMs: 2500, stages: [{ name: "daily", status: "succeeded" }] }]);
  });
});
