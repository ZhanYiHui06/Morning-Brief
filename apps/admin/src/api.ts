import { brief, contents, dashboard, modelConfig, runs, systemStatus } from "./mock";
import type { BriefDraft, ContentItem, DashboardData, ModelConfig, Provider, Run, SystemStatus } from "./types";

export const apiBaseUrl =
  (import.meta.env.VITE_ADMIN_API_URL as string | undefined)?.replace(/\/$/, "") ||
  (import.meta.env.PROD ? "/api" : "");
export const isMockMode = !apiBaseUrl;

async function request<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  if (!apiBaseUrl) return structuredClone(fallback);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return response.status === 204 ? fallback : response.json() as Promise<T>;
}

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0) =>
  typeof value === "number" ? value : fallback;

function mapDashboard(value: unknown): DashboardData {
  const raw = object(value);
  const counts = object(raw.content);
  const delivery = array(raw.delivery).map(object);
  const recentRuns = array(raw.recentRuns).map(object);
  const service = object(raw.service);
  const components = object(service.components);
  return {
    date: text(raw.date),
    briefStatus: text(object(raw.brief).status, "draft") as DashboardData["briefStatus"],
    deliveryStatus: delivery.some((item) => item.status === "sent") ? "sent"
      : delivery.some((item) => item.status === "failed") ? "failed" : "not_sent",
    service: {
      status: text(service.status, "attention") as DashboardData["service"]["status"],
      label: text(service.label, "状态未知"),
      message: text(service.message, "暂时无法判断自动流程的运行状态。"),
      checkedAt: text(service.checkedAt),
      lastRunAt: text(service.lastRunAt) || undefined,
      lastSuccessAt: text(service.lastSuccessAt) || undefined,
      nextRunAt: text(service.nextRunAt) || undefined,
      components: {
        api: Boolean(components.api),
        database: Boolean(components.database),
        automation: Boolean(components.automation),
        scheduler: Boolean(components.scheduler)
      }
    },
    counts: {
      collected: Object.values(counts).reduce<number>((sum, value) => sum + number(value), 0),
      kept: number(counts.kept),
      dropped: number(counts.dropped),
      merged: number(counts.merged),
      published: number(counts.published)
    },
    stages: recentRuns.map((item) => ({
      name: text(item.taskName, "任务"),
      status: (item.status === "queued" ? "running" : text(item.status, "running")) as DashboardData["stages"][number]["status"],
      message: text(item.error) || undefined
    }))
  };
}

function mapContent(value: unknown): ContentItem {
  const item = object(value);
  const status = text(item.status, "pending");
  const decision = status === "kept" ? "keep" : status === "dropped" ? "drop" : status;
  return {
    id: text(item.id),
    author: text(item.author, text(item.sourceName, "未知来源")),
    source: text(item.sourceName, text(item.sourceType)),
    content: text(item.content),
    url: text(item.url) || undefined,
    category: text(item.category, "未分类"),
    decision: decision as ContentItem["decision"],
    scores: {
      relevance: number(item.relevanceScore),
      importance: number(item.importanceScore),
      novelty: number(item.noveltyScore),
      actionability: number(item.actionabilityScore)
    },
    reason: text(item.decisionReason)
  };
}

function mapBrief(value: unknown): BriefDraft {
  const row = object(value);
  const payload = object(row.payload);
  return {
    date: text(payload.date, text(row.date)),
    title: text(payload.title, text(row.title, "今日晨报")),
    deck: text(payload.deck, text(payload.overview)),
    status: (text(payload.status, text(row.status, "draft")) === "published"
      ? "published"
      : text(payload.status, text(row.status)) === "partial" ? "partial" : "draft"),
    highlights: array(payload.highlights).map((entry) => {
      const item = object(entry);
      return { title: text(item.title), summary: text(item.summary) };
    })
  };
}

function mapRun(value: unknown): Run {
  const item = object(value);
  const status = text(item.status, "running");
  return {
    id: text(item.id),
    startedAt: text(item.startedAt, text(item.createdAt)),
    status: (status === "queued" ? "running" : status) as Run["status"],
    trigger: text(item.requestedBy) === "schedule" ? "schedule" : "manual",
    summary: text(item.error, text(item.taskName)),
    stages: []
  };
}

function mapProvider(value: unknown): Provider {
  const item = object(value);
  return {
    id: text(item.id),
    name: text(item.name),
    protocol: "openai-compatible",
    baseUrl: text(item.baseUrl),
    envSecretRef: text(item.secretEnvRef),
    enabled: Boolean(item.enabled),
    health: "unknown"
  };
}

async function loadModelConfig(): Promise<ModelConfig> {
  if (!apiBaseUrl) return structuredClone(modelConfig);
  const [providerResult, modelResult, routeResult] = await Promise.all([
    request<RecordValue>("/providers", { items: [] }),
    request<RecordValue>("/models", { items: [] }),
    request<RecordValue>("/task-routes", { items: [] })
  ]);
  return {
    paused: false,
    providers: array(providerResult.items).map(mapProvider),
    models: array(modelResult.items).map((value) => {
      const item = object(value);
      return {
        id: text(item.id),
        providerId: text(item.providerId),
        modelId: text(item.modelId),
        displayName: text(item.displayName),
        enabled: Boolean(item.enabled),
        structuredOutput: Boolean(item.supportsStructuredOutput)
      };
    }),
    routes: array(routeResult.items).map((value) => {
      const item = object(value);
      const task = text(item.taskKind);
      return {
        task,
        label: task,
        primaryModelId: text(item.primaryModelId),
        fallbackModelId: text(item.fallbackModelId) || undefined
      };
    })
  };
}

async function saveModelConfig(config: ModelConfig) {
  if (!apiBaseUrl) return structuredClone(config);
  await Promise.all(config.providers.map(async (provider) => {
    const body = {
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      secretEnvRef: provider.envSecretRef,
      enabled: provider.enabled
    };
    try {
      await request(`/providers/${provider.id}`, provider, {
        method: "PUT",
        body: JSON.stringify(body)
      });
    } catch {
      await request("/providers", provider, { method: "POST", body: JSON.stringify(body) });
    }
  }));
  await Promise.all(config.models.map(async (model) => {
    const body = {
      providerId: model.providerId,
      modelId: model.modelId,
      displayName: model.displayName,
      supportsStructuredOutput: model.structuredOutput,
      enabled: model.enabled
    };
    try {
      await request(`/models/${model.id}`, model, {
        method: "PUT",
        body: JSON.stringify(body)
      });
    } catch {
      await request("/models", model, { method: "POST", body: JSON.stringify(body) });
    }
  }));
  await Promise.all(config.routes.map(async (route) => {
    const body = {
      taskKind: route.task,
      primaryModelId: route.primaryModelId,
      fallbackModelId: route.fallbackModelId || null,
      timeoutMs: 60_000,
      maxRetries: 1
    };
    try {
      await request(`/task-routes/by-kind/${encodeURIComponent(route.task)}`, route, {
        method: "PUT",
        body: JSON.stringify(body)
      });
    } catch {
      await request("/task-routes", route, { method: "POST", body: JSON.stringify(body) });
    }
  }));
  return config;
}

export const api = {
  dashboard: async () => isMockMode
    ? structuredClone(dashboard)
    : mapDashboard(await request("/dashboard", dashboard)),
  contents: async () => {
    if (isMockMode) return structuredClone(contents);
    const result = await request<unknown>("/content", contents);
    return (Array.isArray(result) ? result : array(object(result).items)).map(mapContent);
  },
  brief: async () => isMockMode
    ? structuredClone(brief)
    : mapBrief(await request("/briefs/latest", brief)),
  modelConfig: loadModelConfig,
  createProvider: async (provider: Omit<Provider, "id" | "health">) => {
    if (!apiBaseUrl) return { ...provider, id: crypto.randomUUID(), health: "unknown" as const };
    const created = await request<unknown>("/providers", {}, {
      method: "POST",
      body: JSON.stringify({
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        secretEnvRef: provider.envSecretRef,
        enabled: provider.enabled
      })
    });
    return mapProvider(created);
  },
  runs: async () => {
    if (isMockMode) return structuredClone(runs);
    const result = await request<unknown>("/runs", runs);
    return (Array.isArray(result) ? result : array(object(result).items)).map(mapRun);
  },
  system: async () => request<SystemStatus>("/system", systemStatus),
  updateContent: (id: string, change: Partial<ContentItem>) => {
    const status = change.decision === "keep" ? "kept"
      : change.decision === "drop" ? "dropped" : change.decision;
    return request(`/content/${id}`, { id, ...change }, {
      method: "PATCH",
      body: JSON.stringify({
        ...(status ? { status } : {}),
        ...(change.category !== undefined ? { category: change.category } : {}),
        ...(change.reason !== undefined ? { decisionReason: change.reason } : {})
      })
    });
  },
  saveBrief: async (draft: BriefDraft) => {
    if (!apiBaseUrl) return structuredClone(draft);
    let current: RecordValue = {};
    try {
      current = object(await request<unknown>("/briefs/latest", {}));
    } catch {
      current = {};
    }
    const currentPayload = object(current.payload);
    const previousHighlights = array(currentPayload.highlights).map(object);
    const payload = {
      builderTopics: [],
      githubTrending: [],
      suggestedActions: [],
      warnings: [],
      sourceStats: { collected: 0, kept: 0, dropped: 0, merged: 0 },
      ...currentPayload,
      id: text(current.id, crypto.randomUUID()),
      date: draft.date,
      generatedAt: text(currentPayload.generatedAt, new Date().toISOString()),
      status: draft.status,
      title: draft.title,
      deck: draft.deck,
      highlights: draft.highlights.map((entry, index) => ({
        id: text(previousHighlights[index]?.id, crypto.randomUUID()),
        sourceItemIds: array(previousHighlights[index]?.sourceItemIds).map(String),
        ...previousHighlights[index],
        title: entry.title,
        summary: entry.summary
      }))
    };
    await request(`/briefs/${draft.date}`, payload, { method: "PUT", body: JSON.stringify(payload) });
    return draft;
  },
  saveModelConfig,
  runTask: (task: string) =>
    request(`/tasks/${task}/trigger`, { accepted: true }, { method: "POST", body: "{}" })
};
