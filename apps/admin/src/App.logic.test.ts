import { describe, expect, it } from "vitest";
import { filterRuns, providerDraftFrom, publishCopy } from "./App";
import type { Provider, Run } from "./types";

const run = (id: string, status: Run["status"], trigger: Run["trigger"]): Run => ({
  id,
  status,
  trigger,
  startedAt: "2026-07-21T00:00:00.000Z",
  summary: id,
  stages: [],
});

describe("admin view state", () => {
  it("filters runs by status and trigger without mutating the source", () => {
    const source = [run("manual-failed", "failed", "manual"), run("scheduled-ok", "succeeded", "schedule")];
    expect(filterRuns(source, "failed").map((item) => item.id)).toEqual(["manual-failed"]);
    expect(filterRuns(source, "schedule").map((item) => item.id)).toEqual(["scheduled-ok"]);
    expect(source).toHaveLength(2);
  });

  it("keeps Provider edits in a detached draft", () => {
    const provider: Provider = {
      id: "provider-1",
      name: "Original",
      protocol: "openai-compatible",
      baseUrl: "https://example.com/v1",
      enabled: true,
      health: "healthy",
      keyConfigured: true,
      modelCount: 2,
    };
    const draft = providerDraftFrom(provider);
    draft.name = "Edited";
    draft.enabled = false;
    expect(provider).toMatchObject({ name: "Original", enabled: true });
  });

  it("never labels draft or partial output as published", () => {
    const published = publishCopy("published");
    expect(publishCopy("draft")).not.toEqual(published);
    expect(publishCopy("partial")).not.toEqual(published);
    expect(publishCopy("failed")).not.toEqual(published);
  });
});
