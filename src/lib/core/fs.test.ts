import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFileSync } from "./fs";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "arb-fs-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("atomicWriteFileSync", () => {
  test("writes file content correctly", () => {
    const filePath = join(tmpDir, "test.json");
    atomicWriteFileSync(filePath, '{"key":"value"}\n');
    expect(readFileSync(filePath, "utf-8")).toBe('{"key":"value"}\n');
  });

  test("does not leave temp file on success", () => {
    const filePath = join(tmpDir, "test.json");
    atomicWriteFileSync(filePath, "content\n");
    expect(existsSync(`${filePath}.tmp.${process.pid}`)).toBe(false);
  });

  test("overwrites existing file", () => {
    const filePath = join(tmpDir, "test.json");
    atomicWriteFileSync(filePath, "first\n");
    atomicWriteFileSync(filePath, "second\n");
    expect(readFileSync(filePath, "utf-8")).toBe("second\n");
  });

  test("throws when directory does not exist", () => {
    const filePath = join(tmpDir, "nonexistent", "test.json");
    expect(() => atomicWriteFileSync(filePath, "content\n")).toThrow();
  });

  test("cleans up temp file when rename fails", () => {
    // Create a directory at the target path — renameSync cannot overwrite a directory with a file
    const filePath = join(tmpDir, "target");
    mkdirSync(filePath);
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    try {
      atomicWriteFileSync(filePath, "content\n");
    } catch {}
    expect(existsSync(tmpPath)).toBe(false);
  });
});
