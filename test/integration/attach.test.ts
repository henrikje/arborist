import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv } from "./helpers/env";

// ── attach ───────────────────────────────────────────────────────

describe("attach", () => {
  test("arb attach reads branch from config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--branch", "feat/custom", "repo-b"]);
      await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      const branch = (await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("feat/custom");
    }));

  test("arb attach skips repo already in workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(
        result.output.includes("already exists") ||
          result.output.includes("Skipping") ||
          result.output.includes("skipping") ||
          result.output.includes("Skipped"),
      ).toBe(true);
    }));

  test("arb attach with nonexistent repo fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["attach", "no-such-repo"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(
        result.output.includes("Unknown repos") ||
          result.output.includes("not a git repo") ||
          result.output.includes("failed"),
      ).toBe(true);
    }));

  test("arb attach without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["attach", "repo-a"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));

  test("arb attach without args fails in non-TTY", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["attach"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No repos specified");
      expect(result.output).toContain("--all-repos");
    }));

  test("arb attach -a adds all remaining repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["attach", "-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb attach --all-repos adds all remaining repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["attach", "--all-repos"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb attach -a when all repos already present errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["attach", "-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("All repos are already in this workspace");
    }));

  test("arb attach recovers from stale worktree reference", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await rm(join(env.projectDir, "my-feature"), { recursive: true });
      await mkdir(join(env.projectDir, "my-feature/.arbws"), { recursive: true });
      await writeFile(
        join(env.projectDir, "my-feature/.arbws/config.json"),
        `${JSON.stringify({ branch: "my-feature" }, null, 2)}\n`,
      );
      const result = await arb(env, ["attach", "repo-a", "repo-b"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb attach tolerates partial failure without aborting", () =>
    withEnv(async (env) => {
      // Create ws-a with repo-a on branch feat/attach-partial
      await arb(env, ["create", "ws-a", "--branch", "feat/attach-partial", "repo-a"]);
      // Create ws-b with repo-b on the same branch
      await arb(env, ["create", "ws-b", "--branch", "feat/attach-partial", "repo-b"]);

      // Try to attach repo-a to ws-b — should fail (branch checked out in ws-a)
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-b") });

      // Attach reports failure but does not destroy the workspace
      expect(result.stderr).toContain("failed");
      expect(existsSync(join(env.projectDir, "ws-b/repo-b"))).toBe(true);
      expect(existsSync(join(env.projectDir, "ws-b/.arbws/config.json"))).toBe(true);
    }));
});
