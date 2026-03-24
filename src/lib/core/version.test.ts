import { describe, expect, test } from "bun:test";
import { buildVersion, validateVersionForFilename } from "./version";

// ── buildVersion ──

describe("buildVersion", () => {
  const defaults = { sha: "abc1234", buildTime: "2026-03-23T19:53:20.483Z" };

  test("clean tag → release semver, no timestamp", () => {
    const result = buildVersion({ ...defaults, tag: "v0.112.0", dirty: false });
    expect(result.version).toBe("0.112.0");
    expect(result.isRelease).toBe(true);
  });

  test("dirty tag → dev version with timestamp", () => {
    const result = buildVersion({ ...defaults, tag: "v0.112.0", dirty: true });
    expect(result.version).toBe(`dev.abc1234.dirty.${defaults.buildTime}`);
    expect(result.isRelease).toBe(false);
  });

  test("no tag, clean → dev version with timestamp", () => {
    const result = buildVersion({ ...defaults, tag: null, dirty: false });
    expect(result.version).toBe(`dev.abc1234.${defaults.buildTime}`);
    expect(result.isRelease).toBe(false);
  });

  test("no tag, dirty → dev.dirty version with timestamp", () => {
    const result = buildVersion({ ...defaults, tag: null, dirty: true });
    expect(result.version).toBe(`dev.abc1234.dirty.${defaults.buildTime}`);
    expect(result.isRelease).toBe(false);
  });

  test("strips v prefix from tag", () => {
    const result = buildVersion({ ...defaults, tag: "v1.0.0", dirty: false });
    expect(result.version).toBe("1.0.0");
  });

  test("release version contains no colons", () => {
    const result = buildVersion({ ...defaults, tag: "v0.112.0", dirty: false });
    expect(result.version).not.toContain(":");
  });

  test("dev version contains timestamp with colons", () => {
    const result = buildVersion({ ...defaults, tag: null, dirty: false });
    expect(result.version).toContain(":");
  });
});

// ── validateVersionForFilename ──

describe("validateVersionForFilename", () => {
  test("accepts clean semver", () => {
    expect(validateVersionForFilename("0.112.0")).toBeNull();
  });

  test("accepts dev version without colons", () => {
    expect(validateVersionForFilename("dev.abc1234")).toBeNull();
  });

  test("rejects version with colon", () => {
    const err = validateVersionForFilename("0.112.0.2026-03-23T19:53:20.483Z");
    expect(err).toContain(":");
  });

  test("rejects version with forward slash", () => {
    const err = validateVersionForFilename("0.112.0/bad");
    expect(err).toContain("/");
  });

  test("rejects version with backslash", () => {
    const err = validateVersionForFilename("0.112.0\\bad");
    expect(err).toContain("\\");
  });
});
