import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, fetchAllRepos, git, pushThenDeleteRemote, withEnv, write } from "./helpers/env";

// ── delete ───────────────────────────────────────────────────────

describe("delete", () => {
  test("arb delete --force removes repos, branches, workspace dir", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await arb(env, ["delete", "my-feature", "--yes", "--force"]);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      const showRef = await git(join(env.projectDir, ".arb/repos/repo-a"), [
        "show-ref",
        "--verify",
        "refs/heads/my-feature",
      ]).catch(() => "not-found");
      expect(showRef).toBe("not-found");
    }));

  test("arb delete -f removes repos, branches, workspace dir", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await arb(env, ["delete", "my-feature", "--yes", "-f"]);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      const showRef = await git(join(env.projectDir, ".arb/repos/repo-a"), [
        "show-ref",
        "--verify",
        "refs/heads/my-feature",
      ]).catch(() => "not-found");
      expect(showRef).toBe("not-found");
    }));

  test("arb delete --force --delete-remote deletes remote branches", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await arb(env, ["delete", "my-feature", "--yes", "--force", "--delete-remote"]);
      const showRef = await git(join(env.projectDir, ".arb/repos/repo-a"), [
        "show-ref",
        "--verify",
        "refs/remotes/origin/my-feature",
      ]).catch(() => "not-found");
      expect(showRef).toBe("not-found");
    }));

  test("arb delete -f -r deletes remote branches", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await arb(env, ["delete", "my-feature", "--yes", "-f", "-r"]);
      const showRef = await git(join(env.projectDir, ".arb/repos/repo-a"), [
        "show-ref",
        "--verify",
        "refs/remotes/origin/my-feature",
      ]).catch(() => "not-found");
      expect(showRef).toBe("not-found");
    }));

  test("arb delete --force --delete-remote reports failed remote delete", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["push", "-u", "origin", "my-feature"]);

      // Make repo-b's remote unreachable so the push --delete fails
      await rename(join(env.originDir, "repo-b.git"), join(env.originDir, "repo-b.git.bak"));

      const result = await arb(env, ["delete", "my-feature", "--yes", "--force", "--delete-remote"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      expect(result.output).toContain("failed to delete remote branch");

      // Restore for teardown
      await rename(join(env.originDir, "repo-b.git.bak"), join(env.originDir, "repo-b.git"));
    }));

  test("arb delete aborts on non-interactive input", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["delete", "my-feature"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not a terminal");
      expect(result.output).toContain("--yes");
    }));

  test("arb delete nonexistent workspace fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["delete", "ghost", "--yes", "--force"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No workspace found");
    }));

  test("arb delete without args fails in non-TTY", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["delete"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No workspace specified");
    }));

  test("arb delete multiple workspaces with --force", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-a", "repo-a"]);
      await arb(env, ["create", "ws-b", "repo-b"]);
      await arb(env, ["delete", "ws-a", "ws-b", "--yes", "--force"]);
      expect(existsSync(join(env.projectDir, "ws-a"))).toBe(false);
      expect(existsSync(join(env.projectDir, "ws-b"))).toBe(false);
    }));

  test("arb delete multiple workspaces removes all", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["delete", "ws-one", "ws-two", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-one"))).toBe(false);
      expect(existsSync(join(env.projectDir, "ws-two"))).toBe(false);
    }));

  test("arb delete refuses workspace with merge conflict", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wt = join(env.projectDir, "my-feature/repo-a");

      // Create a file on the feature branch
      await write(join(wt, "conflict.txt"), "feature");
      await git(wt, ["add", "conflict.txt"]);
      await git(wt, ["commit", "-m", "feature change"]);

      // Create a conflicting change on the default branch via the canonical repo
      const canonical = join(env.projectDir, ".arb/repos/repo-a");
      const defaultBranchRaw = await git(canonical, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      const defaultBranch = defaultBranchRaw.trim().replace(/^origin\//, "");
      await git(canonical, ["checkout", defaultBranch]);
      await write(join(canonical, "conflict.txt"), "main");
      await git(canonical, ["add", "conflict.txt"]);
      await git(canonical, ["commit", "-m", "main change"]);
      await git(canonical, ["push"]);
      await git(canonical, ["checkout", "--detach", "HEAD"]);

      // Fetch and attempt merge to create conflict state
      await git(wt, ["fetch", "origin"]);
      await git(wt, ["merge", `origin/${defaultBranch}`]).catch(() => {});

      // Status should show conflicts
      const statusResult = await arb(env, ["-C", join(env.projectDir, "my-feature"), "status"]);
      expect(statusResult.output).toContain("conflicts");

      // Remove without --force should refuse (non-TTY exits before at-risk check)
      const deleteResult = await arb(env, ["delete", "my-feature"]);
      expect(deleteResult.exitCode).not.toBe(0);
      // Workspace should still exist
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);

      // Force remove should succeed
      await arb(env, ["delete", "my-feature", "--yes", "--force"]);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
    }));
});

// ── delete --all-safe ──────────────────────────────────────────────

describe("delete --all-safe", () => {
  test("arb delete --all-safe removes safe workspaces, keeps dirty", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await arb(env, ["create", "ws-dirty", "repo-a"]);

      // Push ws-clean so it's "safe"
      await git(join(env.projectDir, "ws-clean/repo-a"), ["push", "-u", "origin", "ws-clean"]);

      // Push ws-dirty then dirty it up
      await git(join(env.projectDir, "ws-dirty/repo-a"), ["push", "-u", "origin", "ws-dirty"]);
      await write(join(env.projectDir, "ws-dirty/repo-a/dirty.txt"), "uncommitted");

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-clean"))).toBe(false);
      expect(existsSync(join(env.projectDir, "ws-dirty"))).toBe(true);
    }));

  test("arb delete --all-safe skips current workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-inside", "repo-a"]);
      await git(join(env.projectDir, "ws-inside/repo-a"), ["push", "-u", "origin", "ws-inside"]);

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"], {
        cwd: join(env.projectDir, "ws-inside"),
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-inside"))).toBe(true);
    }));

  test("arb delete --all-safe with no safe workspaces exits cleanly", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-dirty", "repo-a"]);
      await git(join(env.projectDir, "ws-dirty/repo-a"), ["push", "-u", "origin", "ws-dirty"]);
      await write(join(env.projectDir, "ws-dirty/repo-a/dirty.txt"), "uncommitted");

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("No workspaces with safe status");
      expect(existsSync(join(env.projectDir, "ws-dirty"))).toBe(true);
    }));

  test("arb delete --all-safe with positional args errors", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["delete", "--all-safe", "ws-a"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --all-safe with workspace names.");
    }));

  test("arb delete --all-safe --yes --force skips confirmation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-ok", "repo-a"]);
      await git(join(env.projectDir, "ws-ok/repo-a"), ["push", "-u", "origin", "ws-ok"]);

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-ok"))).toBe(false);
    }));

  test("arb delete --all-safe skips config-missing workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-broken", "repo-a"]);
      await git(join(env.projectDir, "ws-broken/repo-a"), ["push", "-u", "origin", "ws-broken"]);
      // Remove config to simulate config-missing state
      await rm(join(env.projectDir, "ws-broken/.arbws/config.json"));

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("No workspaces with safe status");
      expect(existsSync(join(env.projectDir, "ws-broken"))).toBe(true);
    }));

  test("arb delete --all-safe --delete-remote composes correctly", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-rd", "repo-a"]);
      await git(join(env.projectDir, "ws-rd/repo-a"), ["push", "-u", "origin", "ws-rd"]);

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force", "--delete-remote"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-rd"))).toBe(false);
      const showRef = await git(join(env.projectDir, ".arb/repos/repo-a"), [
        "show-ref",
        "--verify",
        "refs/remotes/origin/ws-rd",
      ]).catch(() => "not-found");
      expect(showRef).toBe("not-found");
    }));

  test("arb delete --all-safe includes workspaces that are behind base", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-behind", "repo-a"]);
      await git(join(env.projectDir, "ws-behind/repo-a"), ["push", "-u", "origin", "ws-behind"]);

      // Advance the remote's default branch so ws-behind is behind base
      const canonical = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(canonical, "advance.txt"), "advance");
      await git(canonical, ["add", "advance.txt"]);
      await git(canonical, ["commit", "-m", "advance main"]);
      await git(canonical, ["push"]);

      // Fetch so the workspace sees the new remote state
      await git(join(env.projectDir, "ws-behind/repo-a"), ["fetch", "origin"]);

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-behind"))).toBe(false);
    }));
});

// ── delete --where ──────────────────────────────────────────────

describe("delete --where", () => {
  test("arb delete --where alone selects matching workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-gone", "repo-a"]);
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await pushThenDeleteRemote(env, "ws-gone", "repo-a");
      await git(join(env.projectDir, "ws-clean/repo-a"), ["push", "-u", "origin", "ws-clean"]);
      const result = await arb(env, ["delete", "--where", "gone", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-gone"))).toBe(false);
      expect(existsSync(join(env.projectDir, "ws-clean"))).toBe(true);
    }));

  test("arb delete --where with names uses AND semantics", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-dirty", "repo-a"]);
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await write(join(env.projectDir, "ws-dirty/repo-a/dirty.txt"), "uncommitted");
      const result = await arb(env, ["delete", "ws-dirty", "ws-clean", "--where", "dirty", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-dirty"))).toBe(false);
      expect(existsSync(join(env.projectDir, "ws-clean"))).toBe(true);
    }));

  test("arb delete --where alone without --yes fails in non-TTY", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-gone", "repo-a"]);
      await pushThenDeleteRemote(env, "ws-gone", "repo-a");
      const result = await arb(env, ["delete", "--where", "gone"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not a terminal");
    }));

  test("arb delete --where alone with --dry-run shows matching workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-gone", "repo-a"]);
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await pushThenDeleteRemote(env, "ws-gone", "repo-a");
      await git(join(env.projectDir, "ws-clean/repo-a"), ["push", "-u", "origin", "ws-clean"]);
      const result = await arb(env, ["delete", "--where", "gone", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-gone");
      expect(result.output).toContain("Dry run");
    }));

  test("arb delete --where alone with no matches shows info", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await git(join(env.projectDir, "ws-clean/repo-a"), ["push", "-u", "origin", "ws-clean"]);
      const result = await arb(env, ["delete", "--where", "gone", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("No workspaces match the filter");
    }));
});

// ── delete empty workspace ─────────────────────────────────────

describe("delete empty workspace", () => {
  test("arb delete does not delete empty workspace without confirmation", () =>
    withEnv(async (env) => {
      // Create a workspace, then remove the repo worktree to make it empty
      await arb(env, ["create", "ws-empty", "repo-a"]);
      await rm(join(env.projectDir, "ws-empty/repo-a"), { recursive: true });

      // Without --yes, non-TTY should fail (confirmation required, not silently deleted)
      const result = await arb(env, ["delete", "ws-empty", "--force"]);
      expect(result.exitCode).not.toBe(0);
      expect(existsSync(join(env.projectDir, "ws-empty"))).toBe(true);
    }));

  test("arb delete --yes removes empty workspace after skipping confirmation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-empty", "repo-a"]);
      await rm(join(env.projectDir, "ws-empty/repo-a"), { recursive: true });

      const result = await arb(env, ["delete", "ws-empty", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "ws-empty"))).toBe(false);
    }));

  test("arb delete --all-safe includes empty workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-empty", "repo-a"]);
      await rm(join(env.projectDir, "ws-empty/repo-a"), { recursive: true });

      const result = await arb(env, ["delete", "--all-safe", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("empty");
      expect(existsSync(join(env.projectDir, "ws-empty"))).toBe(false);
    }));

  test("arb delete -N skips fetch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["delete", "my-feature", "--yes", "--force", "-N"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
    }));

  test("arb delete --all-safe fetches each repo only once across multiple workspaces", () =>
    withEnv(async (env) => {
      // Create multiple workspaces all using the same single repo
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-a"]);
      await arb(env, ["create", "ws-three", "repo-a"]);
      await git(join(env.projectDir, "ws-one/repo-a"), ["push", "-u", "origin", "ws-one"]);
      await git(join(env.projectDir, "ws-two/repo-a"), ["push", "-u", "origin", "ws-two"]);
      await git(join(env.projectDir, "ws-three/repo-a"), ["push", "-u", "origin", "ws-three"]);

      const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
      expect(result.exitCode).toBe(0);
      // Should report "1 repo" fetched, not "3 repos"
      expect(result.output).toMatch(/Fetched 1 repo in/);
    }));
});

// ── delete dry-run ───────────────────────────────────────────────

describe("delete dry-run", () => {
  test("arb delete --dry-run shows status without removing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["delete", "my-feature", "--dry-run"], {
        cwd: env.projectDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature");
      expect(result.output).toContain("WORKSPACE");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Deleted");
      // Verify the workspace still exists
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
    }));

  test("arb delete --all-safe --dry-run shows workspaces without removing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await git(join(env.projectDir, "ws-one/repo-a"), ["push", "-u", "origin", "ws-one"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      await git(join(env.projectDir, "ws-two/repo-b"), ["push", "-u", "origin", "ws-two"]);
      const result = await arb(env, ["delete", "--all-safe", "--dry-run"], {
        cwd: env.projectDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).toContain("ws-two");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Deleted");
      // Verify both workspaces still exist
      expect(existsSync(join(env.projectDir, "ws-one"))).toBe(true);
      expect(existsSync(join(env.projectDir, "ws-two"))).toBe(true);
    }));
});

// ── delete merged PR display ────────────────────────────────────

describe("delete merged PR display", () => {
  test("arb delete --dry-run shows PR number for merged workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");

      // Make a commit and push the feature branch
      await write(join(wtRepoA, "feature.txt"), "feature content");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate a PR merge on the canonical repo
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["merge", "origin/my-feature", "--no-ff", "-m", "Merge pull request #42 from user/my-feature"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);

      const result = await arb(env, ["delete", "my-feature", "--dry-run"], {
        cwd: env.projectDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("(#42)");
      expect(result.output).toContain("Dry run");
      // Workspace should still exist
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
    }));
});
