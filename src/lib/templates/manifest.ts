import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function hashContent(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function manifestKey(scope: "workspace" | "repo", relPath: string, repo?: string): string {
  return scope === "workspace" ? `workspace:${relPath}` : `repo:${repo}:${relPath}`;
}

const MANIFEST_FILE = "templates.json";

export function readManifest(wsDir: string): Record<string, string> {
  const path = join(wsDir, ".arbws", MANIFEST_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function writeManifest(wsDir: string, manifest: Record<string, string>): void {
  const dir = join(wsDir, ".arbws");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function mergeManifest(wsDir: string, newEntries: Record<string, string>): void {
  if (Object.keys(newEntries).length === 0) return;
  const existing = readManifest(wsDir);
  writeManifest(wsDir, { ...existing, ...newEntries });
}
