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
  status: z.enum(["completed", "conflicting", "skipped", "pending"]),
  tracking: TrackingSchema,
});

const OperationBaseSchema = z.object({
  startedAt: z.string(),
  status: z.enum(["in-progress", "completed"]),
  repos: z.record(z.string(), RepoOperationStateSchema),
  configBefore: WorkspaceConfigSchema.optional(),
  configAfter: WorkspaceConfigSchema.optional(),
});

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
    error("Run 'arb undo --force' to clear the corrupted record, or delete the file manually");
    throw new ArbError(msg);
  }

  const result = OperationRecordSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; ");
    const msg = `Invalid operation record ${filePath}: ${issues}`;
    error(msg);
    error("Run 'arb undo --force' to clear the corrupted record, or delete the file manually");
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

// ── Gate ──

export function assertNoInProgressOperation(wsDir: string, currentCommand: string): void {
  const record = readOperationRecord(wsDir);
  if (!record) return;
  if (record.status !== "in-progress") return;
  if (record.command === currentCommand) return;

  const commandLabel = record.command === "branch-rename" ? "arb branch rename" : `arb ${record.command}`;
  const msg = `${record.command} in progress — run '${commandLabel}' to continue or 'arb undo' to roll back`;
  error(msg);
  throw new ArbError(msg);
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
