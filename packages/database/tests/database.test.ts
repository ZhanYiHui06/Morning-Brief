import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, createDatabase, migrate, providerSecrets, providers } from "../src/index.js";

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

  it("encrypts provider API keys with authenticated encryption", async () => {
    const { db, client } = createDatabase(":memory:");
    await migrate(client);
    await db.insert(providers).values({ id: "provider-1", name: "test", baseUrl: "https://example.com/v1",
      protocol: "openai-compatible", secretEnvRef: "LEGACY_KEY" }).run();
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptSecret("private-api-key", key);
    await db.insert(providerSecrets).values({ providerId: "provider-1", ...encrypted }).run();
    const row = await db.select().from(providerSecrets).get();
    expect(row?.ciphertext).not.toContain("private-api-key");
    expect(decryptSecret(row!, key)).toBe("private-api-key");
    client.close();
  });
});
