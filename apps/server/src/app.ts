import {
  contentStatusSchema,
  dailyBriefSchema,
  modelInputSchema,
  providerInputSchema,
  taskRouteInputSchema,
} from "@morning-brief/core";
import {
  contentItems,
  dailyBriefs,
  deliveryRecords,
  models,
  pipelineRuns,
  providers,
  taskRoutes,
  type Database,
} from "@morning-brief/database";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  runnableTaskNames,
  StubTaskRunner,
  type RunnableTaskName,
  type TaskRunner,
} from "./runner.js";

type AppDependencies = {
  db: Database;
  runner?: TaskRunner;
  now?: () => Date;
};

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

async function bodyJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function createApp({ db, runner = new StubTaskRunner(), now = () => new Date() }: AppDependencies) {
  const app = new Hono();

  app.use("/api/*", cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal_error" }, 500);
  });

  app.get("/health", (c) =>
    c.json({ ok: true, service: "morning-brief-admin-api" }),
  );

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
    return c.json({
      date,
      content: Object.fromEntries(statusRows.map((row) => [row.status, row.value])),
      brief: brief
        ? { id: brief.id, status: brief.status, generatedAt: brief.generatedAt }
        : null,
      delivery,
      recentRuns,
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

  app.get("/api/providers", async (c) =>
    c.json({ items: await db.select().from(providers).orderBy(providers.name).all() }),
  );

  app.post("/api/providers", async (c) => {
    const parsed = providerInputSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = crypto.randomUUID();
    await db.insert(providers).values({ id, ...parsed.data }).run();
    return c.json(await db.select().from(providers).where(eq(providers.id, id)).get(), 201);
  });

  app.put("/api/providers/:id", async (c) => {
    const parsed = providerInputSchema.safeParse(await bodyJson(c));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = c.req.param("id");
    const result = await db
      .update(providers)
      .set({ ...parsed.data, updatedAt: now().toISOString() })
      .where(eq(providers.id, id))
      .run();
    if (!result.rowsAffected) return c.json({ error: "not_found" }, 404);
    return c.json(await db.select().from(providers).where(eq(providers.id, id)).get());
  });

  app.delete("/api/providers/:id", async (c) => {
    const result = await db
      .delete(providers)
      .where(eq(providers.id, c.req.param("id")))
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
