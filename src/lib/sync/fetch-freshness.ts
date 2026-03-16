/**
 * Fetch TTL — skip redundant fetches within a time window.
 *
 * Stores per-repo fetch timestamps in `.arb/cache/fetch.json`. When all repos
 * in a command were fetched within the TTL, the fetch is skipped entirely.
 * Explicit `--fetch` always fetches regardless of TTL. `ARB_FETCH_TTL=0` disables.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFileSync } from "../core/fs";
import type { FetchResult } from "./parallel-fetch";

// ── Types ────────────────────────────────────────────────────────

export interface FetchTimestamps {
  [repoName: string]: number; // epoch milliseconds
}

// ── TTL resolution ───────────────────────────────────────────────

const DEFAULT_FETCH_TTL = 15;

/** Resolve fetch TTL in seconds from `ARB_FETCH_TTL` env var or default (15s). */
export function fetchTtl(): number {
  const env = process.env.ARB_FETCH_TTL;
  if (env !== undefined) {
    const parsed = Number(env);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_FETCH_TTL;
}

// ── Cache I/O ────────────────────────────────────────────────────

function cachePath(arbRootDir: string): string {
  return join(arbRootDir, ".arb", "cache", "fetch.json");
}

/** Load per-repo fetch timestamps. Returns empty object on missing/corrupt/invalid file. */
export function loadFetchTimestamps(arbRootDir: string): FetchTimestamps {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(arbRootDir), "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/** Atomically save per-repo fetch timestamps. Silent on write failure. */
export function saveFetchTimestamps(arbRootDir: string, timestamps: FetchTimestamps): void {
  const filePath = cachePath(arbRootDir);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    atomicWriteFileSync(filePath, `${JSON.stringify(timestamps)}\n`);
  } catch {
    // Write failure (e.g. read-only filesystem) — silently continue
  }
}

// ── Freshness check ──────────────────────────────────────────────

/** True when every repo in `repoNames` has a timestamp within the TTL window. */
export function allReposFresh(repoNames: string[], timestamps: FetchTimestamps, ttlSeconds: number): boolean {
  if (ttlSeconds <= 0) return false;
  const cutoff = Date.now() - ttlSeconds * 1000;
  return repoNames.every((name) => {
    const ts = timestamps[name];
    return ts !== undefined && ts >= cutoff;
  });
}

// ── Recording ────────────────────────────────────────────────────

/** Record current time for each repo that fetched successfully (exitCode 0). */
export function recordFetchResults(timestamps: FetchTimestamps, results: Map<string, FetchResult>): void {
  const now = Date.now();
  for (const [repo, result] of results) {
    if (result.exitCode === 0) {
      timestamps[repo] = now;
    }
  }
}
