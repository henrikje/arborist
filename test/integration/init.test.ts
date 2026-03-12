import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { arb, withEnv } from "./helpers/env";

describe("init", () => {
  test("arb init creates .arb/repos/", () =>
    withEnv(async (env) => {
      const dir = join(env.testDir, "fresh");
      await mkdir(dir, { recursive: true });
      const result = await arb(env, ["init"], { cwd: dir });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(dir, ".arb"))).toBe(true);
      expect(existsSync(join(dir, ".arb/repos"))).toBe(true);
      expect(result.output).toContain("arb repo clone");
      expect(result.output).toContain("arb create");
    }));

  test("arb init on existing root fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["init"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Already initialized");
    }));

  test("arb init inside workspace fails", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "ws-init-test", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["init"], {
        cwd: join(env.projectDir, "ws-init-test/repo-a"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("inside an existing project");
    }));

  test("arb init with path inside project fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["init", join(env.projectDir, "some-subdir")]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("inside an existing project");
    }));
});
