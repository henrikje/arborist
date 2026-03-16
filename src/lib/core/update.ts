import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { dim, yellow } from "../terminal/output";
import { isTTY } from "../terminal/tty";
import { atomicWriteFileSync } from "./fs";

// ── Constants ──

const CACHE_FILENAME = "version.json";
const GITHUB_API_URL = "https://api.github.com/repos/henrikje/arborist/releases/latest";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

// ── Types ──

export interface UpdateCheckResult {
  notice: string;
}

const UpdateCacheSchema = z.object({
  timestamp: z.string(),
  latestVersion: z.string(),
});

type UpdateCache = z.infer<typeof UpdateCacheSchema>;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

// ── Version parsing ──

export function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

export function isNewerVersion(current: string, latest: string): boolean {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

// ── Install method detection ──

type InstallMethod = "homebrew" | "curl" | "unknown";

export function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath;
  if (execPath.includes("/Cellar/") || execPath.includes("/homebrew/") || execPath.includes("/.linuxbrew/")) {
    return "homebrew";
  }
  const localBin = join(homedir(), ".local", "bin", "arb");
  if (execPath === localBin) {
    return "curl";
  }
  return "unknown";
}

export function getUpdateInstructions(method: InstallMethod): string {
  switch (method) {
    case "homebrew":
      return "brew upgrade arb";
    case "curl":
      return "curl -fsSL https://raw.githubusercontent.com/henrikje/arborist/main/install.sh | bash";
    case "unknown":
      return "Visit https://github.com/henrikje/arborist/releases";
  }
}

// ── Cache ──

export function readUpdateCache(cacheFile: string): UpdateCache | null {
  if (!existsSync(cacheFile)) return null;
  try {
    const raw = JSON.parse(readFileSync(cacheFile, "utf-8"));
    const result = UpdateCacheSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function isCacheStale(cache: UpdateCache): boolean {
  const ts = new Date(cache.timestamp).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > CACHE_TTL_MS;
}

function writeUpdateCache(cacheFile: string, latestVersion: string): void {
  const cache: UpdateCache = {
    timestamp: new Date().toISOString(),
    latestVersion,
  };
  atomicWriteFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
}

// ── Network ──

async function fetchLatestVersion(): Promise<string | null> {
  const response = await fetch(GITHUB_API_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { tag_name?: string };
  const tag = data.tag_name;
  if (typeof tag !== "string") return null;
  return tag.replace(/^v/, "");
}

// ── Notice formatting ──

export function formatUpdateNotice(current: string, latest: string): string {
  const method = detectInstallMethod();
  const instructions = getUpdateInstructions(method);
  const line1 = yellow(`A new version of arb is available: ${current} \u2192 ${latest}`);
  const line2 = `  ${dim("Update:")} ${instructions}`;
  return `${line1}\n${line2}\n`;
}

// ── Main entry point ──

function shouldCheck(currentVersion: string): boolean {
  if (currentVersion.startsWith("dev")) return false;
  if (process.env.ARB_NO_UPDATE_CHECK === "1") return false;
  if (!isTTY()) return false;
  return true;
}

export async function checkForUpdate(currentVersion: string, arbRootDir: string): Promise<UpdateCheckResult | null> {
  try {
    if (!shouldCheck(currentVersion)) return null;

    const cacheFile = join(arbRootDir, ".arb", CACHE_FILENAME);
    let cache = readUpdateCache(cacheFile);

    if (!cache || isCacheStale(cache)) {
      const latest = await fetchLatestVersion();
      if (latest) {
        writeUpdateCache(cacheFile, latest);
        cache = readUpdateCache(cacheFile);
      }
    }

    if (cache && isNewerVersion(currentVersion, cache.latestVersion)) {
      return { notice: formatUpdateNotice(currentVersion, cache.latestVersion) };
    }

    return null;
  } catch {
    return null;
  }
}
