import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperationRecord } from "./operation";
import {
  assertNoInProgressOperation,
  deleteOperationRecord,
  readOperationRecord,
  writeOperationRecord,
} from "./operation";

let tmpDir: string;
let wsDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "arb-op-test-"));
  wsDir = tmpDir;
  mkdirSync(join(wsDir, ".arbws"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true });
});

function validRecord(overrides?: Partial<OperationRecord>): OperationRecord {
  return {
    command: "branch-rename",
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "in-progress",
    repos: {
      "repo-a": { preHead: "abc1234", status: "completed", postHead: "abc1234" },
    },
    oldBranch: "old-branch",
    newBranch: "new-branch",
    configBefore: { branch: "old-branch" },
    configAfter: { branch: "new-branch" },
    ...overrides,
  } as OperationRecord;
}

describe("readOperationRecord", () => {
  test("returns null when file missing", () => {
    expect(readOperationRecord(wsDir)).toBeNull();
  });

  test("parses valid JSON", () => {
    const record = validRecord();
    writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify(record));
    const result = readOperationRecord(wsDir);
    expect(result).not.toBeNull();
    expect(result?.command).toBe("branch-rename");
    expect(result?.status).toBe("in-progress");
  });

  test("throws on invalid JSON", () => {
    writeFileSync(join(wsDir, ".arbws/operation.json"), "not json");
    expect(() => readOperationRecord(wsDir)).toThrow("Failed to parse");
  });

  test("throws on schema violation", () => {
    writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify({ command: "unknown", status: "bad" }));
    expect(() => readOperationRecord(wsDir)).toThrow("Invalid operation record");
  });

  test("parses retarget variant", () => {
    const record = validRecord({
      command: "retarget",
      targetBranch: "main",
      oldBase: "release/1.0",
    } as Partial<OperationRecord>);
    writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify(record));
    const result = readOperationRecord(wsDir);
    expect(result?.command).toBe("retarget");
  });

  test("parses rebase variant", () => {
    const record: OperationRecord = {
      command: "rebase",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
      repos: {},
    };
    writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify(record));
    const result = readOperationRecord(wsDir);
    expect(result?.command).toBe("rebase");
  });
});

describe("writeOperationRecord", () => {
  test("writes valid JSON atomically", () => {
    const record = validRecord();
    writeOperationRecord(wsDir, record);
    const filePath = join(wsDir, ".arbws/operation.json");
    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.command).toBe("branch-rename");
    expect(content.repos["repo-a"].status).toBe("completed");
  });

  test("overwrites existing record", () => {
    writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
    writeOperationRecord(wsDir, validRecord({ status: "completed" }));
    const result = readOperationRecord(wsDir);
    expect(result?.status).toBe("completed");
  });
});

describe("deleteOperationRecord", () => {
  test("removes file", () => {
    writeOperationRecord(wsDir, validRecord());
    expect(readOperationRecord(wsDir)).not.toBeNull();
    deleteOperationRecord(wsDir);
    expect(readOperationRecord(wsDir)).toBeNull();
  });

  test("does not throw on missing file", () => {
    expect(() => deleteOperationRecord(wsDir)).not.toThrow();
  });
});

describe("assertNoInProgressOperation", () => {
  test("passes when no record exists", () => {
    expect(() => assertNoInProgressOperation(wsDir, "rebase")).not.toThrow();
  });

  test("passes when record has status completed", () => {
    writeOperationRecord(wsDir, validRecord({ status: "completed" }));
    expect(() => assertNoInProgressOperation(wsDir, "rebase")).not.toThrow();
  });

  test("passes when currentCommand matches in-progress command", () => {
    writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
    expect(() => assertNoInProgressOperation(wsDir, "branch-rename")).not.toThrow();
  });

  test("throws when different command is in-progress", () => {
    writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
    expect(() => assertNoInProgressOperation(wsDir, "rebase")).toThrow("branch-rename in progress");
  });

  test("error message includes continue and undo guidance", () => {
    writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
    try {
      assertNoInProgressOperation(wsDir, "rebase");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain("arb branch rename");
      expect(msg).toContain("arb undo");
    }
  });

  test("uses correct command label for non-rename commands", () => {
    const record: OperationRecord = {
      command: "rebase",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "in-progress",
      repos: {},
    };
    writeOperationRecord(wsDir, record);
    try {
      assertNoInProgressOperation(wsDir, "merge");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain("arb rebase");
    }
  });
});

// ── pending status ───────────────────────────────────────────────

describe("pending status in schema", () => {
  test("pending status is valid in RepoOperationState", () => {
    const record: OperationRecord = {
      command: "rebase",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "in-progress",
      repos: {
        "repo-a": { preHead: "abc1234", status: "pending" },
        "repo-b": { preHead: "def5678", status: "completed", postHead: "ghi9012" },
      },
    };
    // Should not throw — pending is a valid status
    writeOperationRecord(wsDir, record);
    const result = readOperationRecord(wsDir);
    expect(result).not.toBeNull();
    expect(result?.repos["repo-a"]?.status).toBe("pending");
  });

  test("pending repo is round-tripped through write/read", () => {
    const record: OperationRecord = {
      command: "retarget",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "in-progress",
      targetBranch: "main",
      oldBase: "feat/base",
      repos: {
        "repo-a": { preHead: "abc1234", status: "pending" },
      },
    };
    writeOperationRecord(wsDir, record);
    const result = readOperationRecord(wsDir);
    expect(result).not.toBeNull();
    expect(result?.command).toBe("retarget");
    const repoA = result?.repos["repo-a"];
    expect(repoA?.status).toBe("pending");
    expect(repoA?.preHead).toBe("abc1234");
    expect(repoA?.postHead).toBeUndefined();
  });
});

// ── classifyContinueRepo ─────────────────────────────────────────

describe("classifyContinueRepo", () => {
  // Note: classifyContinueRepo requires a real git repo for conflicting states,
  // but for "completed", "skipped", and "pending" states it only inspects the state object.

  test("returns already-done for completed status", async () => {
    const { classifyContinueRepo } = await import("./operation");
    const state = { preHead: "abc1234", postHead: "def5678", status: "completed" as const };
    const result = await classifyContinueRepo("/nonexistent", state);
    expect(result.action).toBe("already-done");
  });

  test("returns skip for skipped status", async () => {
    const { classifyContinueRepo } = await import("./operation");
    const state = { preHead: "abc1234", status: "skipped" as const };
    const result = await classifyContinueRepo("/nonexistent", state);
    expect(result.action).toBe("skip");
  });

  test("returns needs-execute for pending status", async () => {
    const { classifyContinueRepo } = await import("./operation");
    const state = { preHead: "abc1234", status: "pending" as const };
    const result = await classifyContinueRepo("/nonexistent", state);
    expect(result.action).toBe("needs-execute");
  });
});
