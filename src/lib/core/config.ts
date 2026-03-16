import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { error } from "../terminal/output";
import { ArbError } from "./errors";
import { atomicWriteFileSync } from "./fs";

// ── Schemas ──

export const WorkspaceConfigSchema = z.object({
  branch: z.string(),
  base: z.string().optional(),
  branch_rename_from: z.string().optional(),
  workspace_rename_to: z.string().optional(),
});

export const ProjectConfigSchema = z.object({
  defaults: z.array(z.string()).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ── Read ──

export function readWorkspaceConfig(configFile: string): WorkspaceConfig | null {
  return readConfig(configFile, WorkspaceConfigSchema, migrateWorkspaceIni);
}

export function readProjectConfig(configFile: string): ProjectConfig | null {
  return readConfig(configFile, ProjectConfigSchema, migrateProjectIni);
}

// ── Write ──

export function writeWorkspaceConfig(configFile: string, config: WorkspaceConfig): void {
  writeConfig(configFile, config, WorkspaceConfigSchema);
}

export function writeProjectConfig(configFile: string, config: ProjectConfig): void {
  writeConfig(configFile, config, ProjectConfigSchema);
}

// ── Internal ──

function readConfig<T>(
  configFile: string,
  schema: z.ZodType<T>,
  migrateIni: (raw: Record<string, string>) => unknown,
): T | null {
  if (!existsSync(configFile)) {
    // Try legacy filename (without .json extension)
    const legacyFile = configFile.replace(/\.json$/, "");
    if (legacyFile !== configFile && existsSync(legacyFile)) {
      return migrateLegacyFile(legacyFile, configFile, schema, migrateIni);
    }
    return null;
  }
  const content = readFileSync(configFile, "utf-8");

  // Try JSON first
  let raw: unknown;
  let migrated = false;
  try {
    raw = JSON.parse(content);
  } catch {
    // Not JSON — try legacy INI migration
    const ini = parseIni(content);
    if (Object.keys(ini).length === 0) {
      const msg = `Failed to parse config: ${configFile}`;
      error(msg);
      throw new ArbError(msg);
    }
    raw = migrateIni(ini);
    migrated = true;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; ");
    const msg = `Invalid config ${configFile}: ${issues}`;
    error(msg);
    throw new ArbError(msg);
  }

  if (migrated) {
    try {
      atomicWriteFileSync(configFile, `${JSON.stringify(result.data, null, 2)}\n`);
    } catch {
      // Read-only filesystem — continue with parsed data
    }
  }

  return result.data;
}

function writeConfig<T>(configFile: string, config: T, schema: z.ZodType<T>): void {
  const result = schema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; ");
    const msg = `Invalid config for ${configFile}: ${issues}`;
    error(msg);
    throw new ArbError(msg);
  }
  atomicWriteFileSync(configFile, `${JSON.stringify(result.data, null, 2)}\n`);
}

// ── Legacy filename migration ──

function migrateLegacyFile<T>(
  legacyFile: string,
  newFile: string,
  schema: z.ZodType<T>,
  migrateIni: (raw: Record<string, string>) => unknown,
): T {
  const content = readFileSync(legacyFile, "utf-8");

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    const ini = parseIni(content);
    if (Object.keys(ini).length === 0) {
      const msg = `Failed to parse config: ${legacyFile}`;
      error(msg);
      throw new ArbError(msg);
    }
    raw = migrateIni(ini);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; ");
    const msg = `Invalid config ${legacyFile}: ${issues}`;
    error(msg);
    throw new ArbError(msg);
  }

  try {
    atomicWriteFileSync(newFile, `${JSON.stringify(result.data, null, 2)}\n`);
    unlinkSync(legacyFile);
  } catch {
    // Read-only filesystem — continue with parsed data
  }

  return result.data;
}

// ── INI migration helpers ──

function parseIni(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^(\S+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2];
      if (key !== undefined && value !== undefined) {
        result[key] = value.trim();
      }
    }
  }
  return result;
}

function migrateWorkspaceIni(raw: Record<string, string>): unknown {
  return {
    branch: raw.branch,
    ...(raw.base && { base: raw.base }),
    ...(raw.branch_rename_from && { branch_rename_from: raw.branch_rename_from }),
    ...(raw.workspace_rename_to && { workspace_rename_to: raw.workspace_rename_to }),
  };
}

function migrateProjectIni(raw: Record<string, string>): unknown {
  const defaultsStr = raw.defaults;
  if (!defaultsStr) return {};
  return {
    defaults: defaultsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
