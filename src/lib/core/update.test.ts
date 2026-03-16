import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectInstallMethod,
  formatUpdateNotice,
  getUpdateInstructions,
  isCacheStale,
  isNewerVersion,
  parseVersion,
  readUpdateCache,
} from "./update";

// ── parseVersion ──

describe("parseVersion", () => {
  test("parses valid semver", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  test("parses zero version", () => {
    expect(parseVersion("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  test("parses large numbers", () => {
    expect(parseVersion("0.109.0")).toEqual({ major: 0, minor: 109, patch: 0 });
  });

  test("returns null for dev versions", () => {
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion("dev.abc1234")).toBeNull();
    expect(parseVersion("dev.abc1234.dirty")).toBeNull();
  });

  test("returns null for invalid strings", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3.4")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("abc")).toBeNull();
  });
});

// ── isNewerVersion ──

describe("isNewerVersion", () => {
  test("detects newer major", () => {
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
  });

  test("detects newer minor", () => {
    expect(isNewerVersion("0.109.0", "0.110.0")).toBe(true);
  });

  test("detects newer patch", () => {
    expect(isNewerVersion("1.2.3", "1.2.4")).toBe(true);
  });

  test("returns false for equal versions", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
  });

  test("returns false when current is newer", () => {
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.110.0", "0.109.0")).toBe(false);
  });

  test("returns false for dev versions", () => {
    expect(isNewerVersion("dev", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "dev")).toBe(false);
  });
});

// ── readUpdateCache ──

describe("readUpdateCache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arb-update-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns null for missing file", () => {
    expect(readUpdateCache(join(tmpDir, "nonexistent.json"))).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const file = join(tmpDir, "bad.json");
    writeFileSync(file, "not json");
    expect(readUpdateCache(file)).toBeNull();
  });

  test("returns null for invalid schema", () => {
    const file = join(tmpDir, "bad-schema.json");
    writeFileSync(file, JSON.stringify({ foo: "bar" }));
    expect(readUpdateCache(file)).toBeNull();
  });

  test("reads valid cache", () => {
    const file = join(tmpDir, "valid.json");
    const cache = { timestamp: "2026-03-14T12:00:00.000Z", latestVersion: "0.110.0" };
    writeFileSync(file, JSON.stringify(cache));
    expect(readUpdateCache(file)).toEqual(cache);
  });
});

// ── isCacheStale ──

describe("isCacheStale", () => {
  test("fresh cache is not stale", () => {
    expect(isCacheStale({ timestamp: new Date().toISOString(), latestVersion: "1.0.0" })).toBe(false);
  });

  test("25-hour-old cache is stale", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isCacheStale({ timestamp: old, latestVersion: "1.0.0" })).toBe(true);
  });

  test("invalid date is stale", () => {
    expect(isCacheStale({ timestamp: "not-a-date", latestVersion: "1.0.0" })).toBe(true);
  });
});

// ── detectInstallMethod ──

describe("detectInstallMethod", () => {
  test("returns a valid install method", () => {
    const method = detectInstallMethod();
    expect(["homebrew", "curl", "unknown"]).toContain(method);
  });
});

// ── getUpdateInstructions ──

describe("getUpdateInstructions", () => {
  test("homebrew instructions", () => {
    expect(getUpdateInstructions("homebrew")).toBe("brew upgrade arb");
  });

  test("curl instructions", () => {
    expect(getUpdateInstructions("curl")).toContain("curl");
    expect(getUpdateInstructions("curl")).toContain("install.sh");
  });

  test("unknown instructions", () => {
    expect(getUpdateInstructions("unknown")).toContain("github.com");
  });
});

// ── formatUpdateNotice ──

describe("formatUpdateNotice", () => {
  test("includes current and latest versions", () => {
    const notice = formatUpdateNotice("0.109.0", "0.110.0");
    expect(notice).toContain("0.109.0");
    expect(notice).toContain("0.110.0");
  });

  test("includes update instructions", () => {
    const notice = formatUpdateNotice("0.109.0", "0.110.0");
    expect(notice).toContain("Update:");
  });
});
