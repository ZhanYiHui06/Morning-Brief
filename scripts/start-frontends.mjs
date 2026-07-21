import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function start(script, args, cwd) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    detached: true,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

const adminDirectory = path.join(root, "apps", "admin");
const webDirectory = path.join(root, "apps", "web");

const adminPid = start(
  path.join(adminDirectory, "node_modules", "vite", "bin", "vite.js"),
  ["--host", "127.0.0.1", "--port", "5174", "--strictPort"],
  adminDirectory,
);
const webPid = start(
  path.join(webDirectory, "node_modules", "astro", "astro.js"),
  ["dev", "--host", "127.0.0.1", "--port", "4322"],
  webDirectory,
);

console.log(JSON.stringify({ adminPid, webPid }));
