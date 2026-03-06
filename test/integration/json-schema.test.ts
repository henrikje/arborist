import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type TestEnv, arb, git, withEnv, write } from "./helpers/env";

const VALIDATE_SCRIPT = resolve(join(import.meta.dir, "../../scripts/validate-json-schema.ts"));

/** Validate JSON data against a JSON Schema using ajv. */
async function validate(env: TestEnv, schema: string, data: string): Promise<{ exitCode: number; output: string }> {
  const schemaFile = join(env.testDir, "schema.json");
  const dataFile = join(env.testDir, "data.json");
  await writeFile(schemaFile, schema);
  await writeFile(dataFile, data);
  const proc = Bun.spawn(["bun", "run", VALIDATE_SCRIPT, schemaFile, dataFile], {
    cwd: env.testDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { exitCode, output: stdout + stderr };
}

// ── JSON Schema conformance ──────────────────────────────────────

describe("JSON Schema conformance", () => {
  test("status --json conforms to status --schema", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      const wsCwd = join(env.projectDir, "my-feature");

      const schemaResult = await arb(env, ["status", "--schema"], { cwd: wsCwd });
      const dataResult = await arb(env, ["status", "--no-fetch", "--json"], { cwd: wsCwd });
      const result = await validate(env, schemaResult.stdout, dataResult.stdout);
      expect(result.exitCode).toBe(0);
    }));

  test("log --json conforms to log --schema", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "test commit"]);
      const wsCwd = join(env.projectDir, "my-feature");

      const schemaResult = await arb(env, ["log", "--schema"], { cwd: wsCwd });
      const dataResult = await arb(env, ["log", "--no-fetch", "--json"], { cwd: wsCwd });
      const result = await validate(env, schemaResult.stdout, dataResult.stdout);
      expect(result.exitCode).toBe(0);
    }));

  test("diff --json conforms to diff --schema", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "test commit"]);
      const wsCwd = join(env.projectDir, "my-feature");

      const schemaResult = await arb(env, ["diff", "--schema"], { cwd: wsCwd });
      const dataResult = await arb(env, ["diff", "--no-fetch", "--json"], { cwd: wsCwd });
      const result = await validate(env, schemaResult.stdout, dataResult.stdout);
      expect(result.exitCode).toBe(0);
    }));

  test("branch --json conforms to branch --schema", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wsCwd = join(env.projectDir, "my-feature");

      const schemaResult = await arb(env, ["branch", "--schema"], { cwd: wsCwd });
      const dataResult = await arb(env, ["branch", "--no-fetch", "--json"], { cwd: wsCwd });
      const result = await validate(env, schemaResult.stdout, dataResult.stdout);
      expect(result.exitCode).toBe(0);
    }));

  test("list --json conforms to list --schema", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      const schemaResult = await arb(env, ["list", "--schema"]);
      const dataResult = await arb(env, ["list", "--no-fetch", "--json"]);
      const result = await validate(env, schemaResult.stdout, dataResult.stdout);
      expect(result.exitCode).toBe(0);
    }));

  test("repo list --json conforms to repo list --schema", () =>
    withEnv(async (env) => {
      const schemaResult = await arb(env, ["repo", "list", "--schema"]);
      const dataResult = await arb(env, ["repo", "list", "--json"]);
      const result = await validate(env, schemaResult.stdout, dataResult.stdout);
      expect(result.exitCode).toBe(0);
    }));
});
