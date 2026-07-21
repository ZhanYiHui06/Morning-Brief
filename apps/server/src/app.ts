import {
  contentStatusSchema,
  dailyBriefSchema,
  modelInputSchema,
  taskRouteInputSchema,
} from "@morning-brief/core";
import {
  contentItems,
  dailyBriefs,
  deliveryRecords,
  models,
  pipelineRuns,
  providerConnectionChecks,
  providerSecrets,
  providers,
  encryptSecret,
  decryptSecret,
  readMasterKey,
  taskRoutes,
  type Database,
} from "@morning-brief/database";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  runnableTaskNames,
  type RunnableTaskName,
  type TaskRunner,
} from "./runner.js";
import {
  hasValidBasicCredentials,
  validateProviderBaseUrl,
  type AdminCredentials,
  type HostnameResolver,
} from "./security.js";

type AppDependencies = {
  db: Database;
  runner?: TaskRunner;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  adminCredentials?: AdminCredentials | null;
  allowedOrigins?: string[];
  resolveHostname?: HostnameResolver;
  allowInsecureProviderHttp?: boolean;
};

const providerCreateSchema = z.object({
  name: z.string().trim().min(1),
  protocol: z.literal("openai-compatible").default("openai-compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().trim().min(1).optional(),
  secretEnvRef: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  enabled: z.boolean().default(true),
}).strict().refine((value) => value.apiKey || value.secretEnvRef, {
  message: "apiKey or secretEnvRef is required",
});

const providerUpdateSchema = z.object({
  name: z.string().trim().min(1),
  protocol: z.literal("openai-compatible").default("openai-compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
}).strict();

const importModelsSchema = z.object({
  models: z.array(z.object({
    modelId: z.string().trim().min(1),
    displayName: z.string().trim().min(1).optional(),
  })).min(1).max(200),
}).strict();

const contentQuerySchema = z.object({
  status: contentStatusSchema.optional(),
  sourceType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const contentPatchSchema = z
  .object({
    status: contentStatusSchema.optional(),
    category: z.string().nullable().optional(),
    decisionReason: z.string().nullable().optional(),
    relevanceScore: z.number().int().min(0).max(10).nullable().optional(),
    importanceScore: z.number().int().min(0).max(10).nullable().optional(),
    noveltyScore: z.number().int().min(0).max(10).nullable().optional(),
    actionabilityScore: z.number().int().min(0).max(10).nullable().optional(),
    eventId: z.string().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "empty update");

const triggerBodySchema = z.object({ payload: z.unknown().optional() }).strict();
const runnableTaskSchema = z.enum(runnableTaskNames);
const modelConfigSaveSchema = z.object({
  providers: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    protocol: z.literal("openai-compatible"),
    baseUrl: z.string().url(),
    enabled: z.boolean(),
  })).max(100),
  models: z.array(z.object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    modelId: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    enabled: z.boolean(),
    structuredOutput: z.boolean(),
  })).max(1_000),
  routes: z.array(z.object({
    task: taskRouteInputSchema.shape.taskKind,
    primaryModelId: z.string().min(1),
    fallbackModelId: z.string().min(1).optional(),
  })).max(100),
  paused: z.boolean().optional(),
});

class ModelConfigError extends Error {
  constructor(readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

function jsonValue(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function dateInTimeZone(date: Date, timeZone = process.env.TZ ?? "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateInTimeZone(value);
}

function scheduledDateTime(date: string, time: string | undefined) {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  return new Date(`${date}T${time}:00+08:00`);
}

async function bodyJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function createApp({
  db,
  runner,
  now = () => new Date(),
  fetchImpl = fetch,
  adminCredentials = process.env.ADMIN_BASIC_AUTH_USER && process.env.ADMIN_BASIC_AUTH_PASSWORD
    ? { username: process.env.ADMIN_BASIC_AUTH_USER, password: process.env.ADMIN_BASIC_AUTH_PASSWORD }
    : null,
  allowedOrigins = [
    "http://127.0.0.1:5173", "http://localhost:5173",
    "http://127.0.0.1:5174", "http://localhost:5174",
    "http://127.0.0.1:5175", "http://localhost:5175",
    ...(process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : []),
  ],
  resolveHostname,
  allowInsecureProviderHttp = process.env.ALLOW_INSECURE_PROVIDER_HTTP === "true",
}: AppDependencies) {
  const app = new Hono();

  app.use("/api/*", cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }));

  app.use("/api/*", async (c, next) => {
    if (adminCredentials && !hasValidBasicCredentials(c.req.header("Authorization"), adminCredentials)) {
      c.header("WWW-Authenticate", 'Basic realm="Morning Brief Admin", charset="UTF-8"');
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("Origin");
      if (c.req.header("Sec-Fetch-Site") === "cross-site" || (origin && !allowedOrigins.includes(origin)))
        return c.json({ error: "cross_site_request_rejected" }, 403);
    }
    await next();
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal_error" }, 500);
  });

  app.get("/health", async (c) => {
    try {
      await db.select({ value: count() }).from(pipelineRuns).get();
      return c.json({
        ok: true,
        service: "morning-brief-admin-api",
        database: true,
        checkedAt: now().toISOString(),
      });
    } catch {
      return c.json({
        ok: false,
        service: "morning-brief-admin-api",
        database: false,
        checkedAt: now().toISOString(),
      }, 503);
    }
  });

  app.get("/api/dashboard", async (c) => {
    const date = dateInTimeZone(now());
    const start = new Date(`${date}T00:00:00+08:00`).toISOString();
    const statusRows = await db
      .select({ status: contentItems.status, value: count() })
      .from(contentItems)
      .where(gte(contentItems.collectedAt, start))
      .groupBy(contentItems.status)
      .all();
    const recentRuns = await db
      .select()
      .from(pipelineRuns)
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(10)
      .all();
    const brief = await db
      .select()
      .from(dailyBriefs)
      .where(eq(dailyBriefs.date, date))
      .get();
    const delivery = brief
      ? await db
          .select()
          .from(deliveryRecords)
          .where(eq(deliveryRecords.briefId, brief.id))
          .all()
      : [];
    const checkedAt = now();
    const automationEnabled = process.env.AUTOMATION_ENABLED !== "false";
    const schedulerInstalled = process.env.DAILY_SCHEDULE_INSTALLED === "true";
    const collectionTime = process.env.DAILY_COLLECTION_TIME || undefined;
    const scheduledToday = scheduledDateTime(date, collectionTime);
    const scheduledTomorrow = scheduledDateTime(addCalendarDays(date, 1), collectionTime);
    const nextRunAt = schedulerInstalled && scheduledToday
      ? (checkedAt < scheduledToday ? scheduledToday : scheduledTomorrow)?.toISOString()
      : undefined;
    const activeRun = recentRuns.find((run) => run.status === "queued" || run.status === "running");
    const latestRun = recentRuns[0];
    const latestSuccessfulRun = recentRuns.find((run) => run.status === "succeeded");
    const latestRunIsToday = latestRun?.createdAt
      ? dateInTimeZone(new Date(latestRun.createdAt)) === date
      : false;
    const overdue = Boolean(
      scheduledToday
      && checkedAt.getTime() > scheduledToday.getTime() + 3 * 60 * 60 * 1000
      && !latestRunIsToday,
    );

    let serviceStatus: "healthy" | "running" | "attention" | "error" | "paused" = "healthy";
    let serviceLabel = "运行正常";
    let serviceMessage = brief?.status === "published"
      ? "管理 API、数据库和每日计划均正常，今日晨报已发布。"
      : "管理 API、数据库和每日计划均正常，正在等待下一次计划运行。";

    if (!automationEnabled) {
      serviceStatus = "paused";
      serviceLabel = "自动化已暂停";
      serviceMessage = "服务可以访问，但自动采集与发布当前不会执行。";
    } else if (!schedulerInstalled) {
      serviceStatus = "attention";
      serviceLabel = "定时任务未安装";
      serviceMessage = "管理 API 和数据库正常，但每日自动运行计划尚未安装。";
    } else if (activeRun) {
      serviceStatus = "running";
      serviceLabel = activeRun.status === "queued" ? "等待执行" : "正在生成晨报";
      serviceMessage = "自动流程正在运行，完成后页面会更新最新结果。";
    } else if (latestRun?.status === "failed") {
      serviceStatus = "error";
      serviceLabel = "最近运行失败";
      serviceMessage = latestRun.error
        ? latestRun.error.split("\n")[0].slice(0, 160)
        : "最近一次自动流程没有完成，请查看运行记录。";
    } else if (overdue) {
      serviceStatus = "attention";
      serviceLabel = "今日任务尚未运行";
      serviceMessage = `计划于 ${collectionTime} 开始，但目前没有检测到今日运行记录。`;
    } else if (latestRunIsToday && latestRun?.status === "succeeded" && brief?.status !== "published") {
      serviceStatus = "attention";
      serviceLabel = "发布状态待确认";
      serviceMessage = "今日流程已经结束，但尚未检测到已发布的晨报。";
    }

    return c.json({
      date,
      content: Object.fromEntries(statusRows.map((row) => [row.status, row.value])),
      brief: brief
        ? { id: brief.id, status: brief.status, generatedAt: brief.generatedAt }
        : null,
      delivery,
      recentRuns,
      service: {
        status: serviceStatus,
        label: serviceLabel,
        message: serviceMessage,
        checkedAt: checkedAt.toISOString(),
        lastRunAt: latestRun?.startedAt ?? latestRun?.createdAt ?? null,
        lastSuccessAt: latestSuccessfulRun?.finishedAt ?? null,
        nextRunAt: nextRunAt ?? null,
        components: {
          api: true,
          database: true,
          automation: automationEnabled,
          scheduler: schedulerInstalled,
        },
      },
    });
  });

  app.get("/api/system", (c) => {
    const source = (id: string, name: string, kind: string, envName: string) => ({
      id,
      name,
      kind,
      url: process.env[envName] ?? "",
      enabled: Boolean(process.env[envName]),
    });
    const hookUrlConfigured = Boolean(process.env.OPENCLAW_HOOK_URL);
    const tokenConfigured = Boolean(process.env.OPENCLAW_HOOK_TOKEN);
    const channel = process.env.OPENCLAW_CHANNEL || null;
    return c.json({
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      timeZone: process.env.TZ ?? "Asia/Shanghai",
      publicUrl: process.env.PUBLIC_URL ?? "",
      automation: {
        enabled: process.env.AUTOMATION_ENABLED !== "false",
        reviewGate: process.env.REVIEW_GATE_ENABLED === "true",
        pauseOnSevereError: process.env.PAUSE_ON_SEVERE_ERROR !== "false",
      },
      schedule: {
        installed: process.env.DAILY_SCHEDULE_INSTALLED === "true",
        collectionTime: process.env.DAILY_COLLECTION_TIME || null,
        deliveryTime: process.env.DAILY_DELIVERY_TIME || null,
        maxItems: Number(process.env.DAILY_MAX_ITEMS ?? 15),
      },
      delivery: {
        webPublishing: true,
        wechat: {
          configured: hookUrlConfigured && tokenConfigured && Boolean(channel),
          hookUrlConfigured,
          tokenConfigured,
          channel,
          recipientConfigured: Boolean(process.env.OPENCLAW_TO),
        },
      },
      secrets: {
        githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
        llmKeyConfigured: Boolean(process.env.MORNING_BRIEF_LLM_API_KEY),
      },
      sources: [
        source("zara-x", "Follow Builders · X", "Zara JSON Feed", "ZARA_X_FEED_URL"),
        source("zara-podcasts", "Follow Builders · Podcasts", "Zara JSON Feed", "ZARA_PODCASTS_FEED_URL"),
        source("zara-blogs", "Follow Builders · Blogs", "Zara JSON Feed", "ZARA_BLOGS_FEED_URL"),
        { id: "github-trending", name: "GitHub Trending · Daily Top 5", kind: "GitHub Trending", url: "https://github.com/trending?since=daily", enabled: true },
      ],
      prompts: {
        mode: "code-managed",
        stages: ["筛选与评分", "事件聚合", "Builders 翻译", "GitHub 解读", "今日关键信息", "下一步行动", "晨报编辑"],
      },
    });
  });

  app.get("/api/content", async (c) => {
    const query = contentQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: query.error.flatten() }, 400);
    const filters = [];
    if (query.data.status)
      filters.push(eq(contentItems.status, query.data.status));
    if (query.data.sourceType)
      filters.push(eq(contentItems.sourceType, query.data.sourceType));
    const where = filters.length ? and(...filters) : undefined;
    const items = await db
      .select()
      .from(contentItems)
      .where(where)
      .orderBy(desc(contentItems.collectedAt))
      .limit(query.data.limit)
      .offset(query.data.offset)
      .all();
    const total = (await db
      .select({ value: count() })
      .from(contentItems)
      .where(where)
      .get())?.value ?? 0;
    return c.json({ items, total, ...query.data });
  });

  app.patch("/api/content/:id", async (c) => {
    const parsed = contentPatchSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const current = await db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(eq(contentItems.id, c.req.param("id")))
      .get();
    if (!current) return c.json({ error: "not_found" }, 404);
    await db.update(contentItems)
      .set({ ...parsed.data, updatedAt: now().toISOString() })
      .where(eq(contentItems.id, current.id))
      .run();
    return c.json(
      await db.select().from(contentItems).where(eq(contentItems.id, current.id)).get(),
    );
  });

  app.get("/api/briefs", async (c) => {
    const items = await db
      .select({
        id: dailyBriefs.id,
        date: dailyBriefs.date,
        status: dailyBriefs.status,
        title: dailyBriefs.title,
        generatedAt: dailyBriefs.generatedAt,
        publishedAt: dailyBriefs.publishedAt,
      })
      .from(dailyBriefs)
      .orderBy(desc(dailyBriefs.date))
      .all();
    return c.json({ items });
  });

  app.get("/api/briefs/latest", async (c) => {
    const row = await db
      .select()
      .from(dailyBriefs)
      .orderBy(desc(dailyBriefs.date))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ...row, payload: JSON.parse(row.payloadJson) });
  });

  app.get("/api/briefs/:date", async (c) => {
    const row = await db
      .select()
      .from(dailyBriefs)
      .where(eq(dailyBriefs.date, c.req.param("date")))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ...row, payload: JSON.parse(row.payloadJson) });
  });

  app.put("/api/briefs/:date", async (c) => {
    const parsed = dailyBriefSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    if (parsed.data.date !== c.req.param("date"))
      return c.json({ error: "date_mismatch" }, 400);
    const values = {
      id: parsed.data.id,
      date: parsed.data.date,
      status: parsed.data.status,
      title: parsed.data.title,
      generatedAt: parsed.data.generatedAt,
      payloadJson: JSON.stringify(parsed.data),
      updatedAt: now().toISOString(),
    };
    await db.insert(dailyBriefs)
      .values(values)
      .onConflictDoUpdate({ target: dailyBriefs.date, set: values })
      .run();
    return c.json(parsed.data);
  });

  async function providerView(id?: string) {
    const rows = await db.select().from(providers)
      .where(id ? eq(providers.id, id) : undefined)
      .orderBy(providers.name).all();
    const secretRows = await db.select({ providerId: providerSecrets.providerId }).from(providerSecrets).all();
    const checks = await db.select().from(providerConnectionChecks).all();
    const modelCounts = await db.select({ providerId: models.providerId, value: count() })
      .from(models).groupBy(models.providerId).all();
    const encrypted = new Set(secretRows.map((row) => row.providerId));
    return rows.map((row) => {
      const check = checks.find((entry) => entry.providerId === row.id);
      const keyConfigured = encrypted.has(row.id) || Boolean(process.env[row.secretEnvRef]);
      return {
        id: row.id,
        name: row.name,
        protocol: row.protocol,
        baseUrl: row.baseUrl,
        enabled: row.enabled,
        keyConfigured,
        health: check?.status ?? "unknown",
        checkedAt: check?.checkedAt ?? null,
        connectionMessage: check?.message ?? null,
        modelCount: modelCounts.find((entry) => entry.providerId === row.id)?.value ?? 0,
      };
    });
  }

  async function providerApiKey(providerId: string, secretEnvRef: string) {
    const encrypted = await db.select().from(providerSecrets)
      .where(eq(providerSecrets.providerId, providerId)).get();
    if (encrypted) {
      const key = readMasterKey();
      if (!key) throw new Error("master_key_unavailable");
      return decryptSecret(encrypted, key);
    }
    return process.env[secretEnvRef];
  }

  async function discoverProviderModels(providerId: string) {
    const provider = await db.select().from(providers).where(eq(providers.id, providerId)).get();
    if (!provider) return { error: "not_found" as const };
    const validated = await validateProviderBaseUrl(provider.baseUrl, {
      ...(resolveHostname ? { resolveHostname } : {}),
      allowHttp: allowInsecureProviderHttp,
    });
    if (!validated.ok) return { error: "unsafe_provider_url" as const, reason: validated.reason };
    const apiKey = await providerApiKey(provider.id, provider.secretEnvRef);
    if (!apiKey) return { error: "key_not_configured" as const };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(`${provider.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400)
        return { error: "unsafe_redirect" as const };
      if (!response.ok) return { error: "connection_failed" as const, status: response.status };
      const payload = await response.json() as { data?: Array<{ id?: unknown }> };
      const discovered = (Array.isArray(payload.data) ? payload.data : [])
        .map((entry) => typeof entry.id === "string" ? entry.id : "")
        .filter(Boolean).sort().map((modelId) => ({ modelId, displayName: modelId }));
      return { models: discovered };
    } catch (error) {
      return { error: error instanceof DOMException && error.name === "AbortError"
        ? "connection_timeout" as const : "connection_failed" as const };
    } finally {
      clearTimeout(timer);
    }
  }

  async function recordConnection(providerId: string, status: "healthy" | "error", modelCount: number, message: string) {
    const values = { providerId, status, modelCount, message, checkedAt: now().toISOString() };
    await db.insert(providerConnectionChecks).values(values).onConflictDoUpdate({
      target: providerConnectionChecks.providerId,
      set: { status, modelCount, message, checkedAt: values.checkedAt },
    }).run();
  }

  app.get("/api/providers", async (c) => c.json({ items: await providerView() }));

  app.post("/api/providers", async (c) => {
    const parsed = providerCreateSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const validated = await validateProviderBaseUrl(parsed.data.baseUrl, {
      ...(resolveHostname ? { resolveHostname } : {}),
      allowHttp: allowInsecureProviderHttp,
    });
    if (!validated.ok) return c.json({ error: "unsafe_provider_url", reason: validated.reason }, 400);
    const id = crypto.randomUUID();
    const { apiKey, ...input } = parsed.data;
    const secretEnvRef = input.secretEnvRef ?? `MORNING_BRIEF_PROVIDER_${id.replaceAll("-", "_").toUpperCase()}_KEY`;
    if (apiKey && !readMasterKey()) return c.json({ error: "master_key_not_configured" }, 503);
    await db.insert(providers).values({ id, ...input, secretEnvRef }).run();
    if (apiKey) {
      const secret = encryptSecret(apiKey, readMasterKey()!);
      await db.insert(providerSecrets).values({ providerId: id, ...secret }).run();
    }
    return c.json((await providerView(id))[0], 201);
  });

  app.put("/api/providers/:id", async (c) => {
    const parsed = providerUpdateSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const validated = await validateProviderBaseUrl(parsed.data.baseUrl, {
      ...(resolveHostname ? { resolveHostname } : {}),
      allowHttp: allowInsecureProviderHttp,
    });
    if (!validated.ok) return c.json({ error: "unsafe_provider_url", reason: validated.reason }, 400);
    const id = c.req.param("id");
    if (parsed.data.apiKey && !readMasterKey()) return c.json({ error: "master_key_not_configured" }, 503);
    const result = await db
      .update(providers)
      .set({ name: parsed.data.name, protocol: parsed.data.protocol, baseUrl: parsed.data.baseUrl,
        enabled: parsed.data.enabled, updatedAt: now().toISOString() })
      .where(eq(providers.id, id))
      .run();
    if (!result.rowsAffected) return c.json({ error: "not_found" }, 404);
    if (parsed.data.apiKey) {
      const key = readMasterKey();
      if (!key) return c.json({ error: "master_key_not_configured" }, 503);
      const secret = encryptSecret(parsed.data.apiKey, key);
      await db.insert(providerSecrets).values({ providerId: id, ...secret }).onConflictDoUpdate({
        target: providerSecrets.providerId,
        set: { ...secret, updatedAt: now().toISOString() },
      }).run();
    }
    return c.json((await providerView(id))[0]);
  });

  app.post("/api/providers/:id/test", async (c) => {
    try {
      const result = await discoverProviderModels(c.req.param("id"));
      if ("error" in result) {
        const message = result.error === "key_not_configured" ? "API Key 未配置"
          : result.error === "connection_timeout" ? "连接超时" : "连接失败";
        if (result.error !== "not_found") await recordConnection(c.req.param("id"), "error", 0, message);
        return c.json({
          ok: false,
          error: result.error,
          provider: result.error === "not_found" ? undefined : (await providerView(c.req.param("id")))[0],
        }, result.error === "not_found" ? 404 : 502);
      }
      await recordConnection(c.req.param("id"), "healthy", result.models.length, "连接正常");
      return c.json({
        ok: true,
        modelCount: result.models.length,
        checkedAt: now().toISOString(),
        provider: (await providerView(c.req.param("id")))[0],
      });
    } catch (error) {
      const code = error instanceof Error && error.message === "master_key_unavailable"
        ? "master_key_unavailable" : "connection_failed";
      return c.json({
        ok: false,
        error: code,
        provider: (await providerView(c.req.param("id")))[0],
      }, 503);
    }
  });

  app.get("/api/providers/:id/discover-models", async (c) => {
    try {
      const result = await discoverProviderModels(c.req.param("id"));
      if ("error" in result) return c.json({ error: result.error }, result.error === "not_found" ? 404 : 502);
      return c.json({ items: result.models });
    } catch {
      return c.json({ error: "master_key_unavailable" }, 503);
    }
  });

  app.post("/api/providers/:id/models/import", async (c) => {
    const parsed = importModelsSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const provider = await db.select({ id: providers.id }).from(providers)
      .where(eq(providers.id, c.req.param("id"))).get();
    if (!provider) return c.json({ error: "not_found" }, 404);
    for (const item of parsed.data.models) {
      await db.insert(models).values({ id: crypto.randomUUID(), providerId: provider.id,
        modelId: item.modelId, displayName: item.displayName ?? item.modelId })
        .onConflictDoUpdate({ target: [models.providerId, models.modelId],
          set: { displayName: item.displayName ?? item.modelId, enabled: true, updatedAt: now().toISOString() } }).run();
    }
    return c.json({ items: await db.select().from(models).where(eq(models.providerId, provider.id)).all() }, 201);
  });

  app.delete("/api/providers/:id", async (c) => {
    const providerId = c.req.param("id");
    const primaryRoute = await db
      .select({ taskKind: taskRoutes.taskKind })
      .from(taskRoutes)
      .innerJoin(models, eq(taskRoutes.primaryModelId, models.id))
      .where(eq(models.providerId, providerId))
      .get();
    if (primaryRoute)
      return c.json({ error: "provider_in_use", task: primaryRoute.taskKind }, 409);
    const result = await db
      .delete(providers)
      .where(eq(providers.id, providerId))
      .run();
    return result.rowsAffected
      ? c.body(null, 204)
      : c.json({ error: "not_found" }, 404);
  });

  app.get("/api/models", async (c) => {
    const providerId = c.req.query("providerId");
    const items = await db
      .select()
      .from(models)
      .where(providerId ? eq(models.providerId, providerId) : undefined)
      .orderBy(models.displayName)
      .all();
    return c.json({ items });
  });

  app.put("/api/model-config", async (c) => {
    const parsed = modelConfigSaveSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const config = parsed.data;
    if (new Set(config.providers.map(({ id }) => id)).size !== config.providers.length
      || new Set(config.models.map(({ id }) => id)).size !== config.models.length
      || new Set(config.routes.map(({ task }) => task)).size !== config.routes.length)
      return c.json({ error: "duplicate_config_identifier" }, 400);
    if (new Set(config.providers.map(({ name }) => name)).size !== config.providers.length)
      return c.json({ error: "duplicate_provider_name" }, 409);

    const existingProviders = await db.select().from(providers).all();
    const existingProviderById = new Map(existingProviders.map((provider) => [provider.id, provider]));
    for (const provider of config.providers) {
      const existing = existingProviderById.get(provider.id);
      if (!existing)
        return c.json({ error: "provider_not_found", details: { providerId: provider.id } }, 409);
      const requiresValidation = provider.baseUrl !== existing.baseUrl
        || (!existing.enabled && provider.enabled);
      if (!requiresValidation) continue;
      const validated = await validateProviderBaseUrl(provider.baseUrl, {
        ...(resolveHostname ? { resolveHostname } : {}),
        allowHttp: allowInsecureProviderHttp,
      });
      if (!validated.ok)
        return c.json({ error: "unsafe_provider_url", providerId: provider.id, reason: validated.reason }, 400);
    }

    try {
      await db.transaction(async (tx) => {
        const existingProviders = await tx.select().from(providers).all();
        const providerById = new Map(existingProviders.map((provider) => [provider.id, provider]));
        for (const provider of config.providers) {
          if (!providerById.has(provider.id)) throw new ModelConfigError("provider_not_found", { providerId: provider.id });
          providerById.set(provider.id, { ...providerById.get(provider.id)!, ...provider });
        }

        const existingModels = await tx.select().from(models).all();
        const modelById = new Map(existingModels.map((model) => [model.id, model]));
        for (const model of config.models) {
          if (!modelById.has(model.id)) throw new ModelConfigError("model_not_found", { modelId: model.id });
          if (!providerById.has(model.providerId))
            throw new ModelConfigError("model_provider_not_found", { modelId: model.id, providerId: model.providerId });
          modelById.set(model.id, {
            ...modelById.get(model.id)!,
            ...model,
            supportsStructuredOutput: model.structuredOutput,
          });
        }

        for (const route of config.routes) {
          for (const [role, modelId] of [["primary", route.primaryModelId], ["fallback", route.fallbackModelId]] as const) {
            if (!modelId) continue;
            const model = modelById.get(modelId);
            if (!model) throw new ModelConfigError("route_model_not_found", { task: route.task, role, modelId });
            const provider = providerById.get(model.providerId);
            if (!model.enabled || !provider?.enabled)
              throw new ModelConfigError("route_model_unavailable", { task: route.task, role, modelId });
          }
        }

        const updatedAt = now().toISOString();
        for (const provider of config.providers) {
          await tx.update(providers).set({
            name: provider.name,
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            enabled: provider.enabled,
            updatedAt,
          }).where(eq(providers.id, provider.id)).run();
        }
        for (const model of config.models) {
          await tx.update(models).set({
            providerId: model.providerId,
            modelId: model.modelId,
            displayName: model.displayName,
            supportsStructuredOutput: model.structuredOutput,
            enabled: model.enabled,
            updatedAt,
          }).where(eq(models.id, model.id)).run();
        }
        for (const route of config.routes) {
          await tx.insert(taskRoutes).values({
            id: crypto.randomUUID(),
            taskKind: route.task,
            primaryModelId: route.primaryModelId,
            fallbackModelId: route.fallbackModelId ?? null,
          }).onConflictDoUpdate({
            target: taskRoutes.taskKind,
            set: {
              primaryModelId: route.primaryModelId,
              fallbackModelId: route.fallbackModelId ?? null,
              updatedAt,
            },
          }).run();
        }
      });
    } catch (error) {
      if (error instanceof ModelConfigError)
        return c.json({ error: error.code, details: error.details }, 409);
      const databaseMessage = `${String(error)} ${String((error as { cause?: unknown })?.cause)}`;
      if (/SQLITE_CONSTRAINT|UNIQUE constraint|FOREIGN KEY constraint/i.test(databaseMessage))
        return c.json({ error: "model_config_conflict" }, 409);
      throw error;
    }

    return c.json({
      paused: config.paused ?? false,
      providers: await providerView(),
      models: await db.select().from(models).orderBy(models.displayName).all(),
      routes: await db.select().from(taskRoutes).orderBy(taskRoutes.taskKind).all(),
    });
  });

  app.post("/api/models", async (c) => {
    const parsed = modelInputSchema.strict().safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = crypto.randomUUID();
    await db.insert(models).values({ id, ...parsed.data }).run();
    return c.json(await db.select().from(models).where(eq(models.id, id)).get(), 201);
  });

  app.put("/api/models/:id", async (c) => {
    const parsed = modelInputSchema.strict().safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = c.req.param("id");
    const result = await db
      .update(models)
      .set({ ...parsed.data, updatedAt: now().toISOString() })
      .where(eq(models.id, id))
      .run();
    if (!result.rowsAffected) return c.json({ error: "not_found" }, 404);
    return c.json(await db.select().from(models).where(eq(models.id, id)).get());
  });

  app.delete("/api/models/:id", async (c) => {
    const referencedBy = await db.select({ taskKind: taskRoutes.taskKind }).from(taskRoutes)
      .where(eq(taskRoutes.primaryModelId, c.req.param("id"))).all();
    if (referencedBy.length) return c.json({
      error: "model_in_use",
      message: "Reassign the primary route before deleting this model.",
      taskKinds: referencedBy.map(({ taskKind }) => taskKind),
    }, 409);
    const result = await db.delete(models).where(eq(models.id, c.req.param("id"))).run();
    return result.rowsAffected
      ? c.body(null, 204)
      : c.json({ error: "not_found" }, 404);
  });

  app.get("/api/task-routes", async (c) =>
    c.json({ items: await db.select().from(taskRoutes).orderBy(taskRoutes.taskKind).all() }),
  );

  app.post("/api/task-routes", async (c) => {
    const parsed = taskRouteInputSchema.strict().safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = crypto.randomUUID();
    await db.insert(taskRoutes).values({ id, ...parsed.data }).run();
    return c.json(await db.select().from(taskRoutes).where(eq(taskRoutes.id, id)).get(), 201);
  });

  app.put("/api/task-routes/by-kind/:taskKind", async (c) => {
    const parsed = taskRouteInputSchema.strict().safeParse(await bodyJson(c));
    if (!parsed.success || parsed.data.taskKind !== c.req.param("taskKind"))
      return c.json({ error: "invalid_task_route" }, 400);
    const current = await db
      .select({ id: taskRoutes.id })
      .from(taskRoutes)
      .where(eq(taskRoutes.taskKind, parsed.data.taskKind))
      .get();
    if (!current) return c.json({ error: "not_found" }, 404);
    await db.update(taskRoutes)
      .set({ ...parsed.data, updatedAt: now().toISOString() })
      .where(eq(taskRoutes.id, current.id))
      .run();
    return c.json(await db.select().from(taskRoutes).where(eq(taskRoutes.id, current.id)).get());
  });

  app.put("/api/task-routes/:id", async (c) => {
    const parsed = taskRouteInputSchema.strict().safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = c.req.param("id");
    const result = await db
      .update(taskRoutes)
      .set({ ...parsed.data, updatedAt: now().toISOString() })
      .where(eq(taskRoutes.id, id))
      .run();
    if (!result.rowsAffected) return c.json({ error: "not_found" }, 404);
    return c.json(await db.select().from(taskRoutes).where(eq(taskRoutes.id, id)).get());
  });

  app.delete("/api/task-routes/:id", async (c) => {
    const result = await db
      .delete(taskRoutes)
      .where(eq(taskRoutes.id, c.req.param("id")))
      .run();
    return result.rowsAffected
      ? c.body(null, 204)
      : c.json({ error: "not_found" }, 404);
  });

  app.get("/api/runs", async (c) =>
    c.json({
      items: await db
        .select()
        .from(pipelineRuns)
        .orderBy(desc(pipelineRuns.createdAt))
        .limit(100)
        .all(),
    }),
  );

  app.post("/api/tasks/:task/trigger", async (c) => {
    const task = runnableTaskSchema.safeParse(c.req.param("task"));
    const body = triggerBodySchema.safeParse((await bodyJson(c)) ?? {});
    if (!task.success || !body.success)
      return c.json({ error: "invalid_task_or_payload" }, 400);
    if (!runner) return c.json({ error: "runner_unavailable" }, 503);
    const id = crypto.randomUUID();
    await db.insert(pipelineRuns)
      .values({
        id,
        taskName: task.data,
        status: "queued",
        inputJson: jsonValue(body.data.payload),
      })
      .run();
    try {
      await runner.enqueue({
        runId: id,
        taskName: task.data as RunnableTaskName,
        payload: body.data.payload,
      });
    } catch (error) {
      await db.update(pipelineRuns)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          finishedAt: now().toISOString(),
          updatedAt: now().toISOString(),
        })
        .where(eq(pipelineRuns.id, id))
        .run();
      return c.json({ error: "enqueue_failed", runId: id }, 503);
    }
    return c.json({ runId: id, status: "queued" }, 202);
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}
