export const runnableTaskNames = [
  "collect",
  "process",
  "summarize",
  "build",
  "publish",
  "daily",
] as const;

export type RunnableTaskName = (typeof runnableTaskNames)[number];

export interface TaskRunner {
  enqueue(input: {
    runId: string;
    taskName: RunnableTaskName;
    payload: unknown;
  }): Promise<void>;
}

/**
 * Safe default for the API process. A worker can inject a queue-backed runner;
 * until then, requests are recorded but no shell command or remote action runs.
 */
export class StubTaskRunner implements TaskRunner {
  async enqueue(): Promise<void> {
    return Promise.resolve();
  }
}

export class ProcessTaskRunner implements TaskRunner {
  constructor(
    private readonly command = process.env.TASK_RUNNER_COMMAND ?? "pnpm",
    private readonly args = [
      "--filter",
      "@morning-brief/worker",
      "production-daily",
    ],
  ) {}

  async enqueue(input: { runId: string; taskName: RunnableTaskName; payload: unknown }) {
    if (input.taskName !== "daily") {
      throw new Error(`Production runner currently supports only daily, received ${input.taskName}`);
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.command, [...this.args, "--run-id", input.runId], {
        cwd: process.cwd(),
        env: process.env,
        detached: false,
        stdio: "inherit",
      });
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  }
}
import { spawn } from "node:child_process";
