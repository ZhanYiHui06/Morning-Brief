import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd(), "../..");

describe("production admin edge configuration", () => {
  it("protects both admin surfaces and proxies API traffic", async () => {
    const caddyfile = await readFile(path.join(repositoryRoot, "deploy", "breakfast.caddy"), "utf8");
    expect(caddyfile).toMatch(/@adminProtected path \/admin \/admin\/\* \/api\/\*/);
    expect(caddyfile).toMatch(/basic_auth @adminProtected/);
    expect(caddyfile).toMatch(/handle \/api\/\*[\s\S]*reverse_proxy 127\.0\.0\.1:8787/);
  });

  it("provisions Caddy with the generated username and password hash", async () => {
    const bootstrap = await readFile(path.join(repositoryRoot, "deploy", "bootstrap-server.py"), "utf8");
    expect(bootstrap).toMatch(/\["caddy", "hash-password", "--plaintext", admin_password\]/);
    expect(bootstrap).toContain("/etc/morning-brief/caddy-admin.env");
    expect(bootstrap).toContain("EnvironmentFile=/etc/morning-brief/caddy-admin.env");
    expect(bootstrap).toContain('subprocess.run(["systemctl", "try-restart", "caddy"]');
  });
});
