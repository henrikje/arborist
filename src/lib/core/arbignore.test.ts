import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadArbIgnore } from "./arbignore";

describe("loadArbIgnore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arb-arbignore-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty set when .arbignore does not exist", () => {
    expect(loadArbIgnore(tmpDir)).toEqual(new Set());
  });

  test("returns empty set for empty file", () => {
    writeFileSync(join(tmpDir, ".arbignore"), "");
    expect(loadArbIgnore(tmpDir)).toEqual(new Set());
  });

  test("skips comment lines", () => {
    writeFileSync(join(tmpDir, ".arbignore"), "# this is a comment\nrepo-a\n# another comment\n");
    const result = loadArbIgnore(tmpDir);
    expect(result).toEqual(new Set(["repo-a"]));
    expect(result.has("# this is a comment")).toBe(false);
  });

  test("skips blank lines", () => {
    writeFileSync(join(tmpDir, ".arbignore"), "repo-a\n\n\nrepo-b\n");
    expect(loadArbIgnore(tmpDir)).toEqual(new Set(["repo-a", "repo-b"]));
  });

  test("trims whitespace from names", () => {
    writeFileSync(join(tmpDir, ".arbignore"), "  repo-a  \n\trepo-b\t\n");
    expect(loadArbIgnore(tmpDir)).toEqual(new Set(["repo-a", "repo-b"]));
  });

  test("returns correct set of names", () => {
    writeFileSync(join(tmpDir, ".arbignore"), "repo-a\nrepo-b\nrepo-c\n");
    expect(loadArbIgnore(tmpDir)).toEqual(new Set(["repo-a", "repo-b", "repo-c"]));
  });
});
