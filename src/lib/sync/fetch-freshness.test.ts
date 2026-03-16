import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { FetchResult } from "./parallel-fetch";

import {
  allReposFresh,
  fetchTtl,
  loadFetchTimestamps,
  recordFetchResults,
  saveFetchTimestamps,
} from "./fetch-freshness";

const tmpDir = `/tmp/claude/fetch-freshness-test-${Date.now()}`;

beforeEach(() => {
  mkdirSync(`${tmpDir}/.arb/cache`, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── fetchTtl ─────────────────────────────────────────────────────

describe("fetchTtl", () => {
  test("returns 15 by default", () => {
    process.env.ARB_FETCH_TTL = undefined;
    expect(fetchTtl()).toBe(15);
  });

  test("respects ARB_FETCH_TTL env var", () => {
    process.env.ARB_FETCH_TTL = "30";
    expect(fetchTtl()).toBe(30);
    process.env.ARB_FETCH_TTL = undefined;
  });

  test("returns 0 when ARB_FETCH_TTL=0 (disable)", () => {
    process.env.ARB_FETCH_TTL = "0";
    expect(fetchTtl()).toBe(0);
    process.env.ARB_FETCH_TTL = undefined;
  });

  test("ignores invalid env var value", () => {
    process.env.ARB_FETCH_TTL = "abc";
    expect(fetchTtl()).toBe(15);
    process.env.ARB_FETCH_TTL = undefined;
  });

  test("ignores negative env var value", () => {
    process.env.ARB_FETCH_TTL = "-5";
    expect(fetchTtl()).toBe(15);
    process.env.ARB_FETCH_TTL = undefined;
  });
});

// ── loadFetchTimestamps / saveFetchTimestamps ────────────────────

describe("loadFetchTimestamps", () => {
  test("returns empty object when file does not exist", () => {
    const ts = loadFetchTimestamps(tmpDir);
    expect(ts).toEqual({});
  });

  test("loads existing timestamps", () => {
    const data = { frontend: "2026-03-16T12:00:00.000Z", backend: "2026-03-16T12:01:00.000Z" };
    writeFileSync(`${tmpDir}/.arb/cache/fetch.json`, JSON.stringify(data));
    const ts = loadFetchTimestamps(tmpDir);
    expect(ts).toEqual(data);
  });

  test("returns empty object on corrupt file", () => {
    writeFileSync(`${tmpDir}/.arb/cache/fetch.json`, "not json");
    const ts = loadFetchTimestamps(tmpDir);
    expect(ts).toEqual({});
  });

  test("returns empty object when file contains an array", () => {
    writeFileSync(`${tmpDir}/.arb/cache/fetch.json`, "[1,2,3]");
    const ts = loadFetchTimestamps(tmpDir);
    expect(ts).toEqual({});
  });

  test("returns empty object when file contains a string", () => {
    writeFileSync(`${tmpDir}/.arb/cache/fetch.json`, '"hello"');
    const ts = loadFetchTimestamps(tmpDir);
    expect(ts).toEqual({});
  });

  test("returns empty object when file contains null", () => {
    writeFileSync(`${tmpDir}/.arb/cache/fetch.json`, "null");
    const ts = loadFetchTimestamps(tmpDir);
    expect(ts).toEqual({});
  });

  test("skips non-string values", () => {
    const data = { frontend: "2026-03-16T12:00:00.000Z", backend: 1773670268 };
    writeFileSync(`${tmpDir}/.arb/cache/fetch.json`, JSON.stringify(data));
    const ts = loadFetchTimestamps(tmpDir);
    expect(ts).toEqual({ frontend: "2026-03-16T12:00:00.000Z" });
  });
});

describe("saveFetchTimestamps", () => {
  test("saves timestamps atomically", () => {
    const data = { frontend: "2026-03-16T12:00:00.000Z", backend: "2026-03-16T12:01:00.000Z" };
    saveFetchTimestamps(tmpDir, data);
    const content = readFileSync(`${tmpDir}/.arb/cache/fetch.json`, "utf-8");
    expect(JSON.parse(content)).toEqual(data);
  });

  test("creates cache directory if missing", () => {
    rmSync(`${tmpDir}/.arb/cache`, { recursive: true, force: true });
    saveFetchTimestamps(tmpDir, { repo: "2026-03-16T12:00:00.000Z" });
    expect(existsSync(`${tmpDir}/.arb/cache/fetch.json`)).toBe(true);
  });

  test("does not leave tmp file on success", () => {
    saveFetchTimestamps(tmpDir, { repo: "2026-03-16T12:00:00.000Z" });
    expect(existsSync(`${tmpDir}/.arb/cache/fetch.json.tmp.${process.pid}`)).toBe(false);
  });
});

// ── allReposFresh ────────────────────────────────────────────────

describe("allReposFresh", () => {
  test("returns true when all repos are within TTL", () => {
    const ts = {
      frontend: new Date(Date.now() - 5000).toISOString(),
      backend: new Date(Date.now() - 3000).toISOString(),
    };
    expect(allReposFresh(["frontend", "backend"], ts, 15)).toBe(true);
  });

  test("returns false when any repo is stale", () => {
    const ts = {
      frontend: new Date(Date.now() - 5000).toISOString(),
      backend: new Date(Date.now() - 20000).toISOString(),
    };
    expect(allReposFresh(["frontend", "backend"], ts, 15)).toBe(false);
  });

  test("returns false when a repo has no timestamp", () => {
    const ts = { frontend: new Date(Date.now() - 5000).toISOString() };
    expect(allReposFresh(["frontend", "backend"], ts, 15)).toBe(false);
  });

  test("returns false when timestamps is empty", () => {
    expect(allReposFresh(["frontend"], {}, 15)).toBe(false);
  });

  test("returns false when TTL is 0 (disabled)", () => {
    const ts = { frontend: new Date().toISOString() };
    expect(allReposFresh(["frontend"], ts, 0)).toBe(false);
  });

  test("returns true for empty repo list", () => {
    expect(allReposFresh([], {}, 15)).toBe(true);
  });
});

// ── recordFetchResults ───────────────────────────────────────────

describe("recordFetchResults", () => {
  test("records timestamp for successful repos", () => {
    const ts: Record<string, string> = {};
    const results = new Map<string, FetchResult>([
      ["frontend", { repo: "frontend", exitCode: 0, output: "" }],
      ["backend", { repo: "backend", exitCode: 0, output: "updated" }],
    ]);
    const before = new Date().toISOString();
    recordFetchResults(ts, results);
    const after = new Date().toISOString();
    const fe = ts.frontend;
    const be = ts.backend;
    expect(fe).toBeDefined();
    expect(be).toBeDefined();
    if (fe === undefined || be === undefined) throw new Error("unreachable");
    expect(fe >= before).toBe(true);
    expect(fe <= after).toBe(true);
    expect(be >= before).toBe(true);
    expect(be <= after).toBe(true);
  });

  test("does not record timestamp for failed repos", () => {
    const ts: Record<string, string> = {};
    const results = new Map<string, FetchResult>([
      ["frontend", { repo: "frontend", exitCode: 0, output: "" }],
      ["backend", { repo: "backend", exitCode: 1, output: "error" }],
    ]);
    recordFetchResults(ts, results);
    expect(ts.frontend).toBeDefined();
    expect(ts.backend).toBeUndefined();
  });

  test("overwrites existing timestamp", () => {
    const ts: Record<string, string> = { frontend: "2020-01-01T00:00:00.000Z" };
    const results = new Map<string, FetchResult>([["frontend", { repo: "frontend", exitCode: 0, output: "" }]]);
    recordFetchResults(ts, results);
    const fe = ts.frontend;
    expect(fe).toBeDefined();
    if (fe === undefined) throw new Error("unreachable");
    expect(fe > "2020-01-01T00:00:00.000Z").toBe(true);
  });
});
