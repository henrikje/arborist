import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperationRecord } from "./operation";
import {
  assertNoInProgressOperation,
  deleteOperationRecord,
  finalizeOperationRecord,
  readOperationRecord,
  writeOperationRecord,
} from "./operation";

async function withTestDir(fn: (wsDir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "arb-op-test-"));
  mkdirSync(join(dir, ".arbws"), { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
  test("returns null when file missing", () =>
    withTestDir(async (wsDir) => {
      expect(readOperationRecord(wsDir)).toBeNull();
    }));

  test("parses valid JSON", () =>
    withTestDir(async (wsDir) => {
      const record = validRecord();
      writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify(record));
      const result = readOperationRecord(wsDir);
      expect(result).not.toBeNull();
      expect(result?.command).toBe("branch-rename");
      expect(result?.status).toBe("in-progress");
    }));

  test("throws on invalid JSON", () =>
    withTestDir(async (wsDir) => {
      writeFileSync(join(wsDir, ".arbws/operation.json"), "not json");
      expect(() => readOperationRecord(wsDir)).toThrow("Failed to parse");
    }));

  test("throws on schema violation", () =>
    withTestDir(async (wsDir) => {
      writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify({ command: "unknown", status: "bad" }));
      expect(() => readOperationRecord(wsDir)).toThrow("Invalid operation record");
    }));

  test("parses retarget variant", () =>
    withTestDir(async (wsDir) => {
      const record = validRecord({
        command: "retarget",
        targetBranch: "main",
        oldBase: "release/1.0",
      } as Partial<OperationRecord>);
      writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify(record));
      const result = readOperationRecord(wsDir);
      expect(result?.command).toBe("retarget");
    }));

  test("parses rebase variant", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
        repos: {},
      };
      writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify(record));
      const result = readOperationRecord(wsDir);
      expect(result?.command).toBe("rebase");
    }));
});

describe("writeOperationRecord", () => {
  test("writes valid JSON atomically", () =>
    withTestDir(async (wsDir) => {
      const record = validRecord();
      writeOperationRecord(wsDir, record);
      const filePath = join(wsDir, ".arbws/operation.json");
      expect(existsSync(filePath)).toBe(true);
      const content = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(content.command).toBe("branch-rename");
      expect(content.repos["repo-a"].status).toBe("completed");
    }));

  test("overwrites existing record", () =>
    withTestDir(async (wsDir) => {
      writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
      writeOperationRecord(wsDir, validRecord({ status: "completed" }));
      const result = readOperationRecord(wsDir);
      expect(result?.status).toBe("completed");
    }));
});

describe("deleteOperationRecord", () => {
  test("removes file", () =>
    withTestDir(async (wsDir) => {
      writeOperationRecord(wsDir, validRecord());
      expect(readOperationRecord(wsDir)).not.toBeNull();
      deleteOperationRecord(wsDir);
      expect(readOperationRecord(wsDir)).toBeNull();
    }));

  test("does not throw on missing file", () =>
    withTestDir(async (wsDir) => {
      expect(() => deleteOperationRecord(wsDir)).not.toThrow();
    }));
});

describe("assertNoInProgressOperation", () => {
  test("passes when no record exists", () =>
    withTestDir(async (wsDir) => {
      await assertNoInProgressOperation(wsDir);
    }));

  test("passes when record has status completed", () =>
    withTestDir(async (wsDir) => {
      writeOperationRecord(wsDir, validRecord({ status: "completed" }));
      await assertNoInProgressOperation(wsDir);
    }));

  test("throws when any command is in-progress with configAfter", () =>
    withTestDir(async (wsDir) => {
      writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
      await expect(assertNoInProgressOperation(wsDir)).rejects.toThrow("branch-rename in progress");
    }));

  test("error message includes --continue and --abort guidance", () =>
    withTestDir(async (wsDir) => {
      writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
      try {
        await assertNoInProgressOperation(wsDir);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        expect(msg).toContain("arb branch rename");
        expect(msg).toContain("--continue");
        expect(msg).toContain("--abort");
      }
    }));

  test("uses correct command label for non-rename commands", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "in-progress",
        repos: {},
      };
      writeOperationRecord(wsDir, record);
      try {
        await assertNoInProgressOperation(wsDir);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        expect(msg).toContain("arb rebase");
      }
    }));

  test("blocks when repos have pending status (not auto-completable)", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "in-progress",
        repos: {
          "repo-a": { preHead: "abc1234", status: "completed", postHead: "def5678" },
          "repo-b": { preHead: "abc1234", status: "pending" },
        },
      };
      writeOperationRecord(wsDir, record);
      await expect(assertNoInProgressOperation(wsDir)).rejects.toThrow("rebase in progress");
    }));

  test("blocks when configAfter is present even if all repos completed", () =>
    withTestDir(async (wsDir) => {
      writeOperationRecord(
        wsDir,
        validRecord({
          status: "in-progress",
          repos: {
            "repo-a": { preHead: "abc1234", status: "completed", postHead: "def5678" },
          },
        }),
      );
      // validRecord includes configAfter, so it should block
      await expect(assertNoInProgressOperation(wsDir)).rejects.toThrow("in progress");
    }));

  test("auto-completes when all repos are completed and no configAfter", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "in-progress",
        repos: {
          "repo-a": { preHead: "abc1234", status: "completed", postHead: "def5678" },
          "repo-b": { preHead: "abc1234", status: "completed", postHead: "def5678" },
        },
      };
      writeOperationRecord(wsDir, record);
      await assertNoInProgressOperation(wsDir);
      // Record should now be marked as completed
      const updated = readOperationRecord(wsDir);
      expect(updated?.status).toBe("completed");
    }));
});

// ── pending status ───────────────────────────────────────────────

describe("pending status in schema", () => {
  test("pending status is valid in RepoOperationState", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "in-progress",
        repos: {
          "repo-a": { preHead: "abc1234", status: "pending" },
          "repo-b": { preHead: "def5678", status: "completed", postHead: "ghi9012" },
        },
      };
      writeOperationRecord(wsDir, record);
      const result = readOperationRecord(wsDir);
      expect(result).not.toBeNull();
      expect(result?.repos["repo-a"]?.status).toBe("pending");
    }));

  test("pending repo is round-tripped through write/read", () =>
    withTestDir(async (wsDir) => {
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
    }));
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

// ── finalizeOperationRecord ─────────────────────────────────────

describe("finalizeOperationRecord", () => {
  test("sets outcome, completedAt, and status to completed", () =>
    withTestDir(async (wsDir) => {
      writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
      finalizeOperationRecord(wsDir, "aborted");
      const result = readOperationRecord(wsDir);
      expect(result).not.toBeNull();
      expect(result?.status).toBe("completed");
      expect(result?.outcome).toBe("aborted");
      expect(result?.completedAt).toBeDefined();
    }));

  test("preserves all original record fields", () =>
    withTestDir(async (wsDir) => {
      const original = validRecord({ status: "in-progress" });
      writeOperationRecord(wsDir, original);
      finalizeOperationRecord(wsDir, "completed");
      const result = readOperationRecord(wsDir);
      expect(result?.command).toBe("branch-rename");
      expect(result?.startedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result?.repos["repo-a"]?.preHead).toBe("abc1234");
    }));

  test("no-op when no record exists", () =>
    withTestDir(async (wsDir) => {
      finalizeOperationRecord(wsDir, "completed");
      expect(readOperationRecord(wsDir)).toBeNull();
    }));

  test("falls back to delete on corrupt record", () =>
    withTestDir(async (wsDir) => {
      writeFileSync(join(wsDir, ".arbws/operation.json"), "not json");
      finalizeOperationRecord(wsDir, "force-cleared");
      expect(existsSync(join(wsDir, ".arbws/operation.json"))).toBe(false);
    }));

  test("records different outcomes", () =>
    withTestDir(async (wsDir) => {
      for (const outcome of ["completed", "aborted", "undone", "force-cleared"] as const) {
        writeOperationRecord(wsDir, validRecord({ status: "in-progress" }));
        finalizeOperationRecord(wsDir, outcome);
        const result = readOperationRecord(wsDir);
        expect(result?.outcome).toBe(outcome);
      }
    }));
});

// ── new schema fields ───────────────────────────────────────────

describe("new schema fields", () => {
  test("completedAt is optional and round-trips", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:05:00.000Z",
        status: "completed",
        repos: {},
      };
      writeOperationRecord(wsDir, record);
      const result = readOperationRecord(wsDir);
      expect(result?.completedAt).toBe("2026-01-01T00:05:00.000Z");
    }));

  test("outcome is optional and round-trips", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
        outcome: "undone",
        repos: {},
      };
      writeOperationRecord(wsDir, record);
      const result = readOperationRecord(wsDir);
      expect(result?.outcome).toBe("undone");
    }));

  test("errorOutput is optional and round-trips", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "in-progress",
        repos: {
          "repo-a": {
            preHead: "abc1234",
            status: "conflicting",
            errorOutput: "CONFLICT (content): Merge conflict in file.ts",
          },
        },
      };
      writeOperationRecord(wsDir, record);
      const result = readOperationRecord(wsDir);
      expect(result?.repos["repo-a"]?.errorOutput).toBe("CONFLICT (content): Merge conflict in file.ts");
    }));

  test("records without new fields still parse (backward compat)", () =>
    withTestDir(async (wsDir) => {
      // Simulate an old-format record without completedAt/outcome/errorOutput
      const oldRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
        repos: {
          "repo-a": { preHead: "abc1234", status: "completed", postHead: "def5678" },
        },
      };
      writeFileSync(join(wsDir, ".arbws/operation.json"), JSON.stringify(oldRecord));
      const result = readOperationRecord(wsDir);
      expect(result).not.toBeNull();
      expect(result?.completedAt).toBeUndefined();
      expect(result?.outcome).toBeUndefined();
      expect(result?.repos["repo-a"]?.errorOutput).toBeUndefined();
    }));

  test("auto-complete sets completedAt", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "in-progress",
        repos: {
          "repo-a": { preHead: "abc1234", status: "completed", postHead: "def5678" },
        },
      };
      writeOperationRecord(wsDir, record);
      await assertNoInProgressOperation(wsDir);
      const updated = readOperationRecord(wsDir);
      expect(updated?.status).toBe("completed");
      expect(updated?.completedAt).toBeDefined();
    }));
});

// ── undone status ────────────────────────────────────────────────

describe("undone status", () => {
  test("undone status is valid in RepoOperationState", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
        repos: {
          "repo-a": { preHead: "abc1234", status: "undone" },
          "repo-b": { preHead: "def5678", status: "completed", postHead: "ghi9012" },
        },
      };
      writeOperationRecord(wsDir, record);
      const result = readOperationRecord(wsDir);
      expect(result).not.toBeNull();
      expect(result?.repos["repo-a"]?.status).toBe("undone");
      expect(result?.repos["repo-b"]?.status).toBe("completed");
    }));

  test("classifyContinueRepo returns skip for undone status", async () => {
    const { classifyContinueRepo } = await import("./operation");
    const state = { preHead: "abc1234", status: "undone" as const };
    const result = await classifyContinueRepo("/nonexistent", state);
    expect(result.action).toBe("skip");
  });

  test("assertNoInProgressOperation treats undone repos as resolved", () =>
    withTestDir(async (wsDir) => {
      const record: OperationRecord = {
        command: "rebase",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "in-progress",
        repos: {
          "repo-a": { preHead: "abc1234", status: "undone" },
          "repo-b": { preHead: "def5678", status: "completed", postHead: "ghi9012" },
        },
      };
      writeOperationRecord(wsDir, record);
      // Should auto-complete since undone + completed = all resolved
      await assertNoInProgressOperation(wsDir);
      const updated = readOperationRecord(wsDir);
      expect(updated?.status).toBe("completed");
    }));
});
