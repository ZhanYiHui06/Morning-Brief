import { describe, expect, it } from "vitest";
import { providerInputSchema, taskRouteInputSchema } from "../src/index.js";

describe("shared schemas", () => {
  it("accepts an environment reference instead of an API key", () => {
    const provider = providerInputSchema.parse({
      name: "Local proxy",
      baseUrl: "http://localhost:8317/v1",
      secretEnvRef: "MORNING_BRIEF_LLM_KEY",
    });
    expect(provider.enabled).toBe(true);
    expect(provider).not.toHaveProperty("apiKey");
  });

  it("rejects invalid task route retry limits", () => {
    expect(() =>
      taskRouteInputSchema.parse({
        taskKind: "filter",
        primaryModelId: "fast",
        maxRetries: 99,
      }),
    ).toThrow();
  });
});
