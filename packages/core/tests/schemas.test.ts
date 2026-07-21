import { describe, expect, it } from "vitest";
import { providerInputSchema, taskRouteInputSchema } from "../src/index.js";

describe("shared schemas", () => {
  it("accepts an environment reference instead of an API key", () => {
    const provider = providerInputSchema.parse({
      name: "Example provider",
      baseUrl: "https://api.example.com/v1",
      secretEnvRef: "PRIMARY_LLM_API_KEY",
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
