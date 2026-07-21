import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJsonAtomically(
  targetPath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (!["EEXIST", "EPERM", "EACCES"].includes(code)) throw error;

    // Windows cannot atomically rename over an existing file. Rotate the old
    // file first and restore it if installing the new snapshot fails.
    const backupPath = `${targetPath}.bak`;
    await rm(backupPath, { force: true });
    await rename(targetPath, backupPath);
    try {
      await rename(temporaryPath, targetPath);
      await rm(backupPath, { force: true });
    } catch (replacementError) {
      await rename(backupPath, targetPath).catch(() => undefined);
      throw replacementError;
    }
  }
}

export function snapshotPath(
  dataDirectory: string,
  date: string,
  source: string,
): string {
  return path.join(dataDirectory, "raw", date, `${source}.json`);
}

export function briefPath(dataDirectory: string, date: string): string {
  return path.join(dataDirectory, "briefs", `${date}.json`);
}
