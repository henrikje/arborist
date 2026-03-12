import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

// ── detach ───────────────────────────────────────────────────────

describe("detach", () => {
  test("arb detach removes a repo from workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await arb(env, ["detach", "--yes", "-N", "repo-b"], { cwd: join(env.projectDir, "my-feature") });
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
    }));

  test("arb detach skips repo with uncommitted changes without --force", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["detach", "--yes", "-N", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("uncommitted changes");
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
    }));

  test("arb detach --force removes repo even with uncommitted changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await arb(env, ["detach", "--force", "--yes", "-N", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
    }));

  test("arb detach -f removes repo even with uncommitted changes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await arb(env, ["detach", "-f", "--yes", "-N", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
    }));

  test("arb detach --delete-branch also deletes local branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await arb(env, ["detach", "--delete-branch", "--yes", "-N", "repo-b"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
      const showRef = await git(join(env.projectDir, ".arb/repos/repo-b"), [
        "show-ref",
        "--verify",
        "refs/heads/my-feature",
      ]).catch(() => "not-found");
      expect(showRef).toBe("not-found");
    }));

  test("arb detach skips repo not in workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["detach", "--yes", "-N", "repo-b"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("not in this workspace");
    }));

  test("arb detach rejects unknown repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["detach", "-N", "nonexistent"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown repos: nonexistent");
      expect(result.output).toContain("Not found in .arb/repos/");
    }));

  test("arb detach without args fails in non-TTY", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["detach"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No repos specified");
      expect(result.output).toContain("--all-repos");
    }));

  test("arb detach -a detaches all repos from workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["detach", "-a", "--yes", "-N"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
    }));

  test("arb detach --all-repos detaches all repos from workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["detach", "--all-repos", "--yes", "-N"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
    }));

  test("arb detach -a on empty workspace errors", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "empty-ws/.arbws"), { recursive: true });
      await writeFile(
        join(env.projectDir, "empty-ws/.arbws/config.json"),
        `${JSON.stringify({ branch: "empty" }, null, 2)}\n`,
      );
      const result = await arb(env, ["detach", "-a", "-N"], { cwd: join(env.projectDir, "empty-ws") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No repos in this workspace");
    }));

  test("arb detach without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["detach", "-N", "repo-a"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));

  test("arb detach --dry-run shows plan without executing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["detach", "--dry-run", "-N", "repo-b"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("detach");
      expect(result.output).toContain("Dry run");
      // Repo should still exist
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb detach without --yes in non-TTY errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["detach", "-N", "repo-b"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("--yes");
    }));
});
