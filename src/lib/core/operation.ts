import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { detectOperation, gitLocal, parseGitStatus } from "../git/git";
import { error } from "../terminal/output";
import { WorkspaceConfigSchema } from "./config";
import { ArbError } from "./errors";
import { atomicWriteFileSync } from "./fs";

// ── Schemas ──

const TrackingSchema = z
  .object({
    remote: z.string().optional(),
    merge: z.string().optional(),
  })
  .optional();

const RepoOperationStateSchema = z.object({
  preHead: z.string(),
  postHead: z.string().optional(),
  stashSha: z.string().nullable().optional(),
  status: z.enum(["completed", "conflicting", "skipped", "pending", "undone"]),
  tracking: TrackingSchema,
  errorOutput: z.string().optional(),
});

const OperationOutcomeSchema = z.enum(["completed", "aborted", "undone", "force-cleared"]);

const OperationBaseSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum(["in-progress", "completed"]),
  outcome: OperationOutcomeSchema.optional(),
  repos: z.record(z.string(), RepoOperationStateSchema),
  configBefore: WorkspaceConfigSchema.optional(),
  configAfter: WorkspaceConfigSchema.optional(),
});

export type OperationOutcome = z.infer<typeof OperationOutcomeSchema>;

const OperationRecordSchema = z.discriminatedUnion("command", [
  OperationBaseSchema.extend({ command: z.literal("rebase") }),
  OperationBaseSchema.extend({ command: z.literal("merge") }),
  OperationBaseSchema.extend({ command: z.literal("pull") }),
  OperationBaseSchema.extend({
    command: z.literal("retarget"),
    targetBranch: z.string(),
    oldBase: z.string(),
  }),
  OperationBaseSchema.extend({
    command: z.literal("branch-rename"),
    oldBranch: z.string(),
    newBranch: z.string(),
  }),
  OperationBaseSchema.extend({
    command: z.literal("rename"),
    oldName: z.string(),
    newName: z.string(),
  }),
  OperationBaseSchema.extend({ command: z.literal("reset") }),
  OperationBaseSchema.extend({
    command: z.literal("extract"),
    direction: z.enum(["prefix", "suffix"]),
    targetWorkspace: z.string(),
    targetBranch: z.string(),
  }),
]);

// ── Types ──

export type RepoOperationState = z.infer<typeof RepoOperationStateSchema>;
export type OperationRecord = z.infer<typeof OperationRecordSchema>;

// ── File path ──

function operationFilePath(wsDir: string): string {
  return `${wsDir}/.arbws/operation.json`;
}

// ── Read ──

export function readOperationRecord(wsDir: string): OperationRecord | null {
  const filePath = operationFilePath(wsDir);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    const msg = `Failed to parse operation record: ${filePath}`;
    error(msg);
    error("Run 'arb undo --discard' to clear the corrupted record, or delete the file manually");
    throw new ArbError(msg);
  }

  const result = OperationRecordSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; ");
    const msg = `Invalid operation record ${filePath}: ${issues}`;
    error(msg);
    error("Run 'arb undo --discard' to clear the corrupted record, or delete the file manually");
    throw new ArbError(msg);
  }

  return result.data;
}

// ── Write ──

export function writeOperationRecord(wsDir: string, record: OperationRecord): void {
  const result = OperationRecordSchema.safeParse(record);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; ");
    throw new ArbError(`Invalid operation record: ${issues}`);
  }
  const filePath = operationFilePath(wsDir);
  atomicWriteFileSync(filePath, `${JSON.stringify(result.data, null, 2)}\n`);
}

// ── Build helpers ──

export async function captureRepoState(repoDir: string, repoName: string): Promise<RepoOperationState> {
  const headResult = await gitLocal(repoDir, "rev-parse", "HEAD");
  const preHead = headResult.stdout.trim();
  if (!preHead) throw new ArbError(`Cannot capture HEAD for ${repoName}`);
  const stashResult = await gitLocal(repoDir, "stash", "create");
  return {
    preHead,
    stashSha: stashResult.stdout.trim() || null,
    status: "pending",
  };
}

// ── Delete ──

export function deleteOperationRecord(wsDir: string): void {
  const filePath = operationFilePath(wsDir);
  try {
    unlinkSync(filePath);
  } catch {
    // File may not exist — ignore
  }
}

// ── Finalize ──

/**
 * Mark an operation record as finalized with an outcome instead of deleting it.
 * The record stays in `.arbws/operation.json` until the next operation overwrites it,
 * preserving diagnostic information for debugging.
 */
export function finalizeOperationRecord(wsDir: string, outcome: OperationOutcome): void {
  try {
    const record = readOperationRecord(wsDir);
    if (!record) return;
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    record.outcome = outcome;
    writeOperationRecord(wsDir, record);
  } catch {
    // Record is corrupt or unreadable — fall back to deletion
    deleteOperationRecord(wsDir);
  }
}

// ── Reflog action ──

/**
 * Run an async function with `GIT_REFLOG_ACTION` set so git reflog entries
 * are tagged (e.g. `arb-rebase`, `arb-undo`). The env var is always cleaned
 * up, even if the function throws.
 */
export async function withReflogAction<T>(action: string, fn: () => Promise<T>): Promise<T> {
  process.env.GIT_REFLOG_ACTION = action;
  try {
    return await fn();
  } finally {
    delete process.env.GIT_REFLOG_ACTION;
  }
}

// ── Gate ──

export async function assertNoInProgressOperation(wsDir: string): Promise<void> {
  const record = readOperationRecord(wsDir);
  if (!record) return;
  if (record.status !== "in-progress") return;

  // Auto-complete when all repos are resolved and no deferred config needs applying.
  // Short-circuit: skip classification only when repos are pending (never started)
  // or deferred config exists. Conflicting repos need classification since the user
  // may have resolved them externally via git.
  const repoStates = Object.values(record.repos);
  const hasPending = repoStates.some((s) => s.status === "pending");
  if (!record.configAfter && !hasPending) {
    const entries = Object.entries(record.repos);
    const classifications = await Promise.all(
      entries.map(async ([repoName, state]) => {
        const repoDir = `${wsDir}/${repoName}`;
        return { repoName, classification: await classifyContinueRepo(repoDir, state) };
      }),
    );
    const allResolved = classifications.every(
      (c) =>
        c.classification.action === "already-done" ||
        c.classification.action === "manually-continued" ||
        c.classification.action === "skip",
    );
    if (allResolved) {
      // Update manually-continued repos in the record
      for (const c of classifications) {
        if (c.classification.action === "manually-continued") {
          const existing = record.repos[c.repoName];
          if (existing) {
            record.repos[c.repoName] = { ...existing, status: "completed", postHead: c.classification.postHead };
          }
        }
      }
      record.status = "completed";
      record.completedAt = new Date().toISOString();
      writeOperationRecord(wsDir, record);
      return;
    }
  }

  const commandLabel = record.command === "branch-rename" ? "arb branch rename" : `arb ${record.command}`;
  const msg = `${record.command} in progress — use '${commandLabel} --continue' to resume or '${commandLabel} --abort' to cancel`;
  error(msg);
  throw new ArbError(msg);
}

/** Read the in-progress operation record if it matches the given command. Returns null if no match. */
export function readInProgressOperation(wsDir: string, command: string): OperationRecord | null {
  const record = readOperationRecord(wsDir);
  if (!record) return null;
  if (record.status !== "in-progress") return null;
  if (record.command !== command) return null;
  return record;
}

// ── Continue reconciliation ──

export type ContinueClassification =
  | { action: "still-conflicting" }
  | { action: "will-continue" }
  | { action: "manually-aborted" }
  | { action: "manually-continued"; postHead: string }
  | { action: "already-done" }
  | { action: "skip" }
  | { action: "needs-execute" }
  | { action: "unexpected-operation"; operation: string };

export async function classifyContinueRepo(
  repoDir: string,
  state: RepoOperationState,
): Promise<ContinueClassification> {
  if (state.status === "completed") return { action: "already-done" };
  if (state.status === "skipped") return { action: "skip" };
  if (state.status === "undone") return { action: "skip" };
  if (state.status === "pending") return { action: "needs-execute" };

  // status === "conflicting"
  const op = await detectOperation(repoDir);
  if (op === "rebase" || op === "merge") {
    const status = await parseGitStatus(repoDir);
    if (status.conflicts > 0) return { action: "still-conflicting" };
    return { action: "will-continue" };
  }
  if (op !== null) {
    // User started a different git operation (cherry-pick, revert, bisect, am)
    return { action: "unexpected-operation", operation: op };
  }

  // No git operation in progress — user resolved or aborted manually
  const headResult = await gitLocal(repoDir, "rev-parse", "HEAD");
  const currentHead = headResult.stdout.trim();
  if (currentHead === state.preHead) return { action: "manually-aborted" };
  return { action: "manually-continued", postHead: currentHead };
}
