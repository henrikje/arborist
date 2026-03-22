import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { error } from "../terminal/output";
import { WorkspaceConfigSchema } from "./config";
import { ArbError } from "./errors";
import { atomicWriteFileSync } from "./fs";

// ── Schemas ──

const RepoOperationStateSchema = z.object({
  preHead: z.string(),
  postHead: z.string().optional(),
  stashSha: z.string().nullable().optional(),
  status: z.enum(["completed", "conflicting", "skipped"]),
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
    throw new ArbError(msg);
  }

  const result = OperationRecordSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; ");
    const msg = `Invalid operation record ${filePath}: ${issues}`;
    error(msg);
    throw new ArbError(msg);
  }

  return result.data;
}

// ── Write ──

export function writeOperationRecord(wsDir: string, record: OperationRecord): void {
  const filePath = operationFilePath(wsDir);
  atomicWriteFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
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
