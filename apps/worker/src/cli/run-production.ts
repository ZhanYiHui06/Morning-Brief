import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDatabase,
  dailyBriefs,
  deliveryRecords,
  migrate,
  pipelineRuns,
} from "@morning-brief/database";
import { and, eq } from "drizzle-orm";
import { createDeliveryIdempotencyKey } from "../delivery/adapter.js";
import { OpenClawWebhookDeliveryAdapter } from "../delivery/openclaw.js";
import { dailyBriefSchema } from "../schemas.js";
import { main as runDaily } from "./run-daily.js";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function shanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function command(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function publishWeb(dataDirectory: string, publicDirectory: string) {
  await command("pnpm", ["--filter", "@morning-brief/web", "build"], {
    BRIEFS_DIR: path.join(dataDirectory, "briefs"),
  });
  const source = path.join(workspaceRoot, "apps/web/dist");
  const releaseName = new Date().toISOString().replace(/[:.]/g, "-");
  const releases = path.join(publicDirectory, "releases");
  const release = path.join(releases, releaseName);
  const temporaryLink = path.join(publicDirectory, ".current-next");
  const currentLink = path.join(publicDirectory, "current");
  await mkdir(releases, { recursive: true });
  await cp(source, release, { recursive: true });
  await rm(temporaryLink, { force: true, recursive: true });
  // Keep the link relative so it resolves both inside the container (/public)
  // and from the host bind mount (/var/lib/morning-brief/public).
  await symlink(path.join("releases", releaseName), temporaryLink, "dir");
  await rename(temporaryLink, currentLink);
  await copyFile(path.join(source, "index.html"), path.join(release, ".published"));
}

async function main() {
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? "/data");
  const publicDirectory = path.resolve(process.env.PUBLIC_DIR ?? "/public");
  const databaseUrl = process.env.DATABASE_URL ?? path.join(dataDirectory, "morning-brief.sqlite");
  const date = argument("--date") ?? shanghaiDate();
  const existingRunId = argument("--run-id");
  const runId = existingRunId ?? randomUUID();
  await mkdir(dataDirectory, { recursive: true });
  const lockPath = path.join(dataDirectory, "daily.lock");
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("A daily pipeline run is already active");
    throw error;
  });
  const { db, client } = createDatabase(databaseUrl);
  await migrate(client);
  const now = new Date().toISOString();
  if (!existingRunId) {
    await db.insert(pipelineRuns).values({
      id: runId,
      taskName: "daily",
      status: "queued",
      requestedBy: argument("--requested-by") ?? "schedule",
    }).run();
  }
  await db.update(pipelineRuns).set({ status: "running", startedAt: now, updatedAt: now })
    .where(eq(pipelineRuns.id, runId)).run();

  try {
    await runDaily(["--date", date]);
    await publishWeb(dataDirectory, publicDirectory);
    const briefFile = path.join(dataDirectory, "briefs", `${date}.json`);
    const brief = dailyBriefSchema.parse(JSON.parse(await readFile(briefFile, "utf8")));
    const publishedAt = new Date().toISOString();
    const publishedPayload = { ...brief, status: "published" as const };
    await db.update(dailyBriefs).set({
      status: "published",
      publishedAt,
      payloadJson: JSON.stringify(publishedPayload),
      updatedAt: publishedAt,
    }).where(eq(dailyBriefs.date, date)).run();

    const hookUrl = process.env.OPENCLAW_HOOK_URL;
    const hookToken = process.env.OPENCLAW_HOOK_TOKEN;
    const hookChannel = process.env.OPENCLAW_CHANNEL;
    if (hookUrl && hookToken && hookChannel) {
      const idempotencyKey = createDeliveryIdempotencyKey(brief, "wechat");
      const hash = createHash("sha256").update(idempotencyKey).digest("hex");
      const adapter = new OpenClawWebhookDeliveryAdapter({
        url: hookUrl,
        token: hookToken,
        channel: hookChannel,
        ...(process.env.OPENCLAW_TO ? { to: process.env.OPENCLAW_TO } : {}),
        publicUrl: process.env.PUBLIC_URL ?? "https://breakfast.151014.xyz",
        hasDelivered: async () => Boolean(await db.select({ id: deliveryRecords.id })
          .from(deliveryRecords)
          .where(and(
            eq(deliveryRecords.briefId, brief.id),
            eq(deliveryRecords.channel, "wechat"),
            eq(deliveryRecords.contentHash, hash),
            eq(deliveryRecords.status, "sent"),
          )).get()),
      });
      try {
        const result = await adapter.deliver(brief, { idempotencyKey });
        await db.insert(deliveryRecords).values({
          id: randomUUID(),
          briefId: brief.id,
          channel: "wechat",
          contentHash: hash,
          status: result.status === "sent" ? "sent" : "skipped",
          attemptCount: 1,
          sentAt: result.status === "sent" ? new Date().toISOString() : null,
        }).onConflictDoUpdate({
          target: [deliveryRecords.briefId, deliveryRecords.channel, deliveryRecords.contentHash],
          set: {
            status: result.status === "sent" ? "sent" : "skipped",
            attemptCount: 1,
            sentAt: result.status === "sent" ? new Date().toISOString() : null,
            error: null,
            updatedAt: new Date().toISOString(),
          },
        }).run();
      } catch (error) {
        await db.insert(deliveryRecords).values({
          id: randomUUID(),
          briefId: brief.id,
          channel: "wechat",
          contentHash: hash,
          status: "failed",
          attemptCount: 1,
          error: error instanceof Error ? error.message : String(error),
        }).onConflictDoUpdate({
          target: [deliveryRecords.briefId, deliveryRecords.channel, deliveryRecords.contentHash],
          set: {
            status: "failed",
            attemptCount: 1,
            error: error instanceof Error ? error.message : String(error),
            updatedAt: new Date().toISOString(),
          },
        }).run();
        throw error;
      }
    }

    const finishedAt = new Date().toISOString();
    await db.update(pipelineRuns).set({
      status: "succeeded",
      resultJson: JSON.stringify({ date, briefId: brief.id, publishedAt }),
      finishedAt,
      updatedAt: finishedAt,
    }).where(eq(pipelineRuns.id, runId)).run();
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await db.update(pipelineRuns).set({
      status: "failed",
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      finishedAt,
      updatedAt: finishedAt,
    }).where(eq(pipelineRuns.id, runId)).run();
    throw error;
  } finally {
    client.close();
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
