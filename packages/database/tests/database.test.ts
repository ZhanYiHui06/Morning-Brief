import { describe, expect, it } from "vitest";
import { createDatabase, migrate, providers } from "../src/index.js";

describe("database bootstrap", () => {
  it("creates tables and persists provider secret references only", async () => {
    const { db, client } = createDatabase(":memory:");
    await migrate(client);
    await db.insert(providers)
      .values({
        id: "provider-1",
        name: "test",
        baseUrl: "https://example.com/v1",
        protocol: "openai-compatible",
        secretEnvRef: "TEST_API_KEY",
      })
      .run();
    const row = await db.select().from(providers).get();
    expect(row?.secretEnvRef).toBe("TEST_API_KEY");
    client.close();
  });
});
