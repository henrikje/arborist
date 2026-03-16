/**
 * Persistent analysis cache.
 *
 * Stores expensive git analysis results (merge detection, replay plans, share divergence)
 * keyed by immutable SHA tuples. When the same repo is at the same HEAD + base + share
 * position, the cached result is reused — no git calls needed.
 *
 * Cache entries are content-addressable: the key is a SHA-256 hash of the schema version,
 * repo name, and three ref SHAs. Different schema versions produce different keys, so
 * mixed arb versions coexist and old-format entries age out via the size cap.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// ── Schema version ───────────────────────────────────────────────

/** Bump this when the entry schema changes. Old entries become unreachable. */
const ANALYSIS_CACHE_VERSION = 1;

// ── Entry schema ─────────────────────────────────────────────────
// Matches the corresponding parts of the RepoStatus model.

const MergeCacheSchema = z.object({
  kind: z.enum(["merge", "squash"]),
  newCommitsAfter: z.number().optional(),
  commitHash: z.string().optional(),
  detectedPr: z
    .object({
      number: z.number(),
      url: z.string().nullable(),
      mergeCommit: z.string().optional(),
    })
    .optional(),
});

const ReplayPlanCacheSchema = z.object({
  totalLocal: z.number(),
  alreadyOnTarget: z.number(),
  toReplay: z.number(),
  contiguous: z.boolean(),
  mergedPrefix: z.boolean().optional(),
});

const OutdatedCacheSchema = z.object({
  total: z.number(),
  rebased: z.number(),
  replaced: z.number(),
  squashed: z.number(),
});

const AnalysisCacheEntrySchema = z.object({
  merge: MergeCacheSchema.optional(),
  replayPlan: ReplayPlanCacheSchema.optional(),
  outdated: OutdatedCacheSchema.optional(),
  timestamp: z.number(),
});

export type AnalysisCacheEntry = z.infer<typeof AnalysisCacheEntrySchema>;

const AnalysisCacheFileSchema = z.object({
  entries: z.record(z.string(), AnalysisCacheEntrySchema),
});

// ── Constants ────────────────────────────────────────────────────

const MAX_ENTRIES = 500;
const EVICT_TO = 400;

// ── Cache key ────────────────────────────────────────────────────

/** Build a cache key hash from repo name and ref SHAs. */
export function analysisCacheKey(repoName: string, headSHA: string, baseSHA: string, shareSHA: string): string {
  const raw = `${ANALYSIS_CACHE_VERSION}\n${repoName}\n${headSHA}\n${baseSHA}\n${shareSHA}`;
  return createHash("sha256").update(raw).digest("hex");
}

// ── AnalysisCache class ──────────────────────────────────────────

export class AnalysisCache {
  private entries: Map<string, AnalysisCacheEntry>;
  private dirty = false;
  private filePath: string;

  private constructor(filePath: string, entries: Map<string, AnalysisCacheEntry>) {
    this.filePath = filePath;
    this.entries = entries;
  }

  /** Current schema version — exposed for `arb dump`. */
  static get schemaVersion(): number {
    return ANALYSIS_CACHE_VERSION;
  }

  /** Load the analysis cache from disk. Returns an empty cache on missing/corrupt file. */
  static load(arbRootDir: string): AnalysisCache {
    const filePath = join(arbRootDir, ".arb", "cache", "analysis.json");
    const entries = new Map<string, AnalysisCacheEntry>();

    if (!existsSync(filePath)) {
      return new AnalysisCache(filePath, entries);
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const raw = JSON.parse(content);
      const result = AnalysisCacheFileSchema.safeParse(raw);
      if (result.success) {
        for (const [key, entry] of Object.entries(result.data.entries)) {
          entries.set(key, entry);
        }
      }
    } catch {
      // Corrupt or unreadable — start fresh
    }

    return new AnalysisCache(filePath, entries);
  }

  /** Look up a cached analysis entry. Returns null on miss. */
  lookup(key: string): AnalysisCacheEntry | null {
    return this.entries.get(key) ?? null;
  }

  /** Store an analysis entry in the cache. */
  store(key: string, entry: AnalysisCacheEntry): void {
    this.entries.set(key, entry);
    this.dirty = true;
  }

  /** Number of entries in the cache. */
  get size(): number {
    return this.entries.size;
  }

  /** Path to the cache file. */
  get path(): string {
    return this.filePath;
  }

  /** Oldest entry timestamp (epoch seconds), or null if empty. */
  get oldestTimestamp(): number | null {
    let oldest: number | null = null;
    for (const entry of this.entries.values()) {
      if (oldest === null || entry.timestamp < oldest) {
        oldest = entry.timestamp;
      }
    }
    return oldest;
  }

  /** Newest entry timestamp (epoch seconds), or null if empty. */
  get newestTimestamp(): number | null {
    let newest: number | null = null;
    for (const entry of this.entries.values()) {
      if (newest === null || entry.timestamp > newest) {
        newest = entry.timestamp;
      }
    }
    return newest;
  }

  /** Save the cache to disk if it was modified. Evicts old entries if over size cap. */
  save(): void {
    if (!this.dirty) return;

    // Evict oldest entries if over size cap
    if (this.entries.size > MAX_ENTRIES) {
      const sorted = [...this.entries.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.slice(0, sorted.length - EVICT_TO);
      for (const [key] of toRemove) {
        this.entries.delete(key);
      }
    }

    const data = {
      entries: Object.fromEntries(this.entries),
    };

    try {
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
      renameSync(tmpPath, this.filePath);
    } catch {
      // Write failure (e.g. read-only filesystem) — silently continue
    }
  }
}
