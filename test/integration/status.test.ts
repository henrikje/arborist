import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  arb,
  deleteWorkspaceConfig,
  fetchAllRepos,
  git,
  gitBelow238,
  initBareRepo,
  withEnv,
  write,
} from "./helpers/env";

const ARB_BIN = resolve(join(import.meta.dir, "../../dist/arb"));

// ── status ───────────────────────────────────────────────────────

describe("status", () => {
  test("arb status shows ahead count after local commit", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/new.txt"), "new");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "new.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "ahead"]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("1 ahead");
    }));

  test("arb status shows behind count when default branch is ahead", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      // Add a commit to origin's default branch
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("1 behind");
    }));

  test("arb status shows no branch when branch not on remote", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("no branch");
    }));

  test("arb status shows up to date after push with no new commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "commit"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("up to date");
    }));

  test("arb status without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["status"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));

  test("arb status shows wrong branch in branch column", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Manually switch repo-a to a different branch
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "-b", "experiment"]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      // repo-a should show experiment in branch column and origin/experiment in remote column
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("experiment");
      expect(result.output).toContain("origin/experiment");
      // repo-b should show expected branch
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("my-feature");
    }));

  test("arb status uses configured base branch for stacked workspaces", () =>
    withEnv(async (env) => {
      // Create a base branch with 2 unique commits in repo-a
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth"]);
      await write(join(repoA, "auth2.txt"), "auth2");
      await git(repoA, ["add", "auth2.txt"]);
      await git(repoA, ["commit", "-m", "auth2"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      // repo-b does NOT have feat/auth — only main

      // Create stacked workspace with both repos
      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);

      // Add a commit to the feature branch in repo-a (on top of feat/auth)
      const wtRepoA = join(env.projectDir, "stacked/repo-a");
      await write(join(wtRepoA, "ui.txt"), "ui-change");
      await git(wtRepoA, ["add", "ui.txt"]);
      await git(wtRepoA, ["commit", "-m", "ui change"]);

      // Add a commit to the feature branch in repo-b (on top of main)
      const wtRepoB = join(env.projectDir, "stacked/repo-b");
      await write(join(wtRepoB, "ui.txt"), "ui-change-b");
      await git(wtRepoB, ["add", "ui.txt"]);
      await git(wtRepoB, ["commit", "-m", "ui change b"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "stacked") });

      // repo-a: should compare against feat/auth (1 ahead, not 3 ahead which it would be vs main)
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("feat/auth");
      expect(result.output).toContain("1 ahead");

      // repo-b: base branch feat/auth doesn't exist — should show configured base with "not found"
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("not found");
    }));

  test("default branch detection with master", () =>
    withEnv(async (env) => {
      await initBareRepo(env.testDir, join(env.originDir, "repo-master.git"), "master");
      await git(env.testDir, [
        "clone",
        join(env.originDir, "repo-master.git"),
        join(env.projectDir, ".arb/repos/repo-master"),
      ]);
      const repoMaster = join(env.projectDir, ".arb/repos/repo-master");
      await git(repoMaster, ["commit", "--allow-empty", "-m", "init"]);
      await git(repoMaster, ["push"]);

      await arb(env, ["create", "test-master", "repo-master"]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "test-master") });
      expect(result.output).toContain("master");
    }));

  test("arb status --fetch fetches before showing status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--fetch"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("repo-a");
    }));

  test("arb status -N skips fetch (short for --no-fetch)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "-N"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("Fetched");
    }));

  test("arb status shows origin to push count", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "first"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);
      // Now make another commit without pushing
      await write(join(wtRepoA, "g.txt"), "more");
      await git(wtRepoA, ["add", "g.txt"]);
      await git(wtRepoA, ["commit", "-m", "second"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("1 to push");
    }));

  test("arb status shows origin to pull count", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "first"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);
      // Clone a fresh copy, push a commit to origin on my-feature
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("1 to pull");
    }));

  test("arb status on default branch behind origin shows to pull not merged", () =>
    withEnv(async (env) => {
      // Detach HEAD in canonical repo so a main worktree can be created
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["checkout", "--detach"]);
      await arb(env, ["create", "main-ws", "--branch", "main", "repo-a"]);
      // Push a commit directly to origin's main
      const tmpMain = join(env.testDir, "tmp-main");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMain]);
      await write(join(tmpMain, "new.txt"), "new");
      await git(tmpMain, ["add", "new.txt"]);
      await git(tmpMain, ["commit", "-m", "upstream"]);
      await git(tmpMain, ["push"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "main-ws") });
      expect(result.output).toContain("1 to pull");
      expect(result.output).not.toContain("merged");
    }));

  test("arb status never-pushed branch behind base does not show merged", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "never-pushed", "repo-a"]);
      // Advance origin's main so the branch is behind base
      const tmpAdvance = join(env.testDir, "tmp-advance");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpAdvance]);
      await write(join(tmpAdvance, "new.txt"), "new");
      await git(tmpAdvance, ["add", "new.txt"]);
      await git(tmpAdvance, ["commit", "-m", "advance main"]);
      await git(tmpAdvance, ["push"]);
      await rm(tmpAdvance, { recursive: true });
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "never-pushed") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("no branch");
      expect(result.output).not.toContain("merged");
    }));

  test("arb status never-pushed branch squash-merged into base shows merged", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "never-pushed-merged", "repo-a"]);
      const wtRepoA = join(env.projectDir, "never-pushed-merged/repo-a");

      // Add commits to the worktree (never push)
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);

      // Squash merge the branch into main via the canonical repo
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      const headSha = (await git(wtRepoA, ["rev-parse", "HEAD"])).trim();
      await git(repoA, ["merge", "--squash", headSha]);
      await git(repoA, ["commit", "-m", "feat: add feature (#99)"]);
      await git(repoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "never-pushed-merged") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).not.toContain("ahead");

      // JSON output should have merge set
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "never-pushed-merged"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge).not.toBeNull();
      expect(json.repos[0].base.merge.kind).toBe("squash");
    }));

  test("arb status shows pushed and synced repo as up to date", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "commit"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("up to date");
      expect(result.output).toContain("clean");
    }));

  test("arb status shows ahead of base and pushed as up to date remote", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "first"]);
      await write(join(wtRepoA, "g.txt"), "change2");
      await git(wtRepoA, ["add", "g.txt"]);
      await git(wtRepoA, ["commit", "-m", "second"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("2 ahead");
      expect(result.output).toContain("origin/my-feature");
      expect(result.output).toContain("up to date");
    }));

  test("arb status shows diverged base counts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      // Make a local commit
      await write(join(wtRepoA, "local.txt"), "local");
      await git(wtRepoA, ["add", "local.txt"]);
      await git(wtRepoA, ["commit", "-m", "local"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);
      // Advance main on origin
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("1 ahead");
      expect(result.output).toContain("1 behind");
    }));

  test("arb status shows detached HEAD", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      // Detach HEAD in the worktree
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      const headSha = (await git(wtRepoA, ["rev-parse", "HEAD"])).trim();
      await git(wtRepoA, ["checkout", headSha]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("(detached)");
      expect(result.output).toContain("detached");
    }));

  test("arb status detects upstream mismatch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "commit"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);
      // Create another remote branch and set upstream to it
      await git(wtRepoA, ["push", "origin", "my-feature:other-branch"]);
      await git(wtRepoA, ["branch", "--set-upstream-to=origin/other-branch"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      // Remote column should show origin/other-branch (mismatch)
      expect(result.output).toContain("origin/other-branch");
    }));

  test("arb status shows multiple local change types", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      // Create a tracked file, commit, then modify
      await write(join(wtRepoA, "tracked.txt"), "orig");
      await git(wtRepoA, ["add", "tracked.txt"]);
      await git(wtRepoA, ["commit", "-m", "add tracked"]);
      // Stage a new file
      await write(join(wtRepoA, "staged.txt"), "staged");
      await git(wtRepoA, ["add", "staged.txt"]);
      // Modify tracked file
      await write(join(wtRepoA, "tracked.txt"), "changed");
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("1 staged");
      expect(result.output).toContain("1 modified");
    }));

  test("arb status shows fell-back base branch for stacked workspace", () =>
    withEnv(async (env) => {
      // repo-a has feat/auth, repo-b does NOT
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a", "repo-b"]);
      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "stacked") });
      // repo-a should show feat/auth as base
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("feat/auth");
      // repo-b should show configured base (feat/auth) with "not found" instead of fallback
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("not found");
    }));

  test("arb status detects rebase in progress", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      // Set up conflicting changes for rebase
      await write(join(wtRepoA, "conflict.txt"), "base");
      await git(wtRepoA, ["add", "conflict.txt"]);
      await git(wtRepoA, ["commit", "-m", "base"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Push a conflicting commit on main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "conflict.txt"), "upstream-conflict");
      await git(repoA, ["add", "conflict.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      // Fetch and start a rebase that will conflict
      await fetchAllRepos(env);
      try {
        await git(wtRepoA, ["rebase", "origin/main"]);
      } catch {
        // Expected to fail due to conflict
      }

      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("(rebase)");
    }));

  test("arb status detects merge conflicts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "conflict.txt"), "base");
      await git(wtRepoA, ["add", "conflict.txt"]);
      await git(wtRepoA, ["commit", "-m", "base"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Push a conflicting commit on main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "conflict.txt"), "upstream-conflict");
      await git(repoA, ["add", "conflict.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      await fetchAllRepos(env);
      // Start a merge that will conflict
      try {
        await git(wtRepoA, ["merge", "origin/main"]);
      } catch {
        // Expected to fail due to conflict
      }

      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("conflicts");
      expect(result.output).toContain("(merge)");
    }));
});

// ── missing config recovery ──────────────────────────────────────

describe("missing config recovery", () => {
  test("arb status works with missing config (infers branch)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await deleteWorkspaceConfig(env, "my-feature");
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("repo-a");
      // Should warn about missing config
      expect(result.output).toMatch(/Config missing|inferred branch/);
    }));

  test("arb attach works when worktrees exist but config is missing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await deleteWorkspaceConfig(env, "my-feature");
      const result = await arb(env, ["attach", "repo-b"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
      // Verify repo-b is on the inferred branch
      const branch = (await git(join(env.projectDir, "my-feature/repo-b"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("my-feature");
    }));

  test("arb attach fails when config is missing and no worktrees exist", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "empty-ws/.arbws"), { recursive: true });
      await writeFile(
        join(env.projectDir, "empty-ws/.arbws/config.json"),
        `${JSON.stringify({ branch: "empty-ws" }, null, 2)}\n`,
      );
      await deleteWorkspaceConfig(env, "empty-ws");
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "empty-ws") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toMatch(/No branch configured|no worktrees to infer/);
    }));

  test("arb delete --force works with missing config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await deleteWorkspaceConfig(env, "my-feature");
      await arb(env, ["delete", "my-feature", "--yes", "--force"]);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      // Branch should still be cleaned up
      let showRefFailed = false;
      try {
        await git(join(env.projectDir, ".arb/repos/repo-a"), ["show-ref", "--verify", "refs/heads/my-feature"]);
      } catch {
        showRefFailed = true;
      }
      expect(showRefFailed).toBe(true);
    }));

  test("arb list shows config missing indicator", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await deleteWorkspaceConfig(env, "my-feature");
      const result = await arb(env, ["list"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature");
      expect(result.output).toContain("config missing");
    }));

  test("arb pull works with missing config (infers branch)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "first"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);
      await deleteWorkspaceConfig(env, "my-feature");
      const result = await arb(env, ["pull"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toMatch(/inferred branch|Config missing/);
    }));
});

// ── status conflict prediction ───────────────────────────────────

describe.skipIf(gitBelow238)("status conflict prediction", () => {
  test("arb status shows diverged with overlapping changes (conflict path)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      // Create a shared file on main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "shared.txt"), "original");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "add shared"]);
      await git(repoA, ["push"]);

      // Pull the shared file into the feature branch
      await fetchAllRepos(env);
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Conflicting change on feature branch
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "shared.txt"), "feature version");
      await git(wtRepoA, ["add", "shared.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature change"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Conflicting change on main
      await write(join(repoA, "shared.txt"), "main version");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "main change"]);
      await git(repoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0); // diverged is stale, not at-risk
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("1 ahead");
      expect(result.output).toContain("1 behind");
    }));

  test("arb status shows diverged with non-overlapping changes (clean path)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      // Local commit on feature branch (different file)
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "local.txt"), "local");
      await git(wtRepoA, ["add", "local.txt"]);
      await git(wtRepoA, ["commit", "-m", "local"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Upstream commit on main (different file)
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0); // diverged is stale, not at-risk
      expect(result.output).toContain("1 ahead");
      expect(result.output).toContain("1 behind");
    }));

  test("arb status --json includes predictions for diverged repo with conflict", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      // Create a shared file on main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "shared.txt"), "original");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "add shared"]);
      await git(repoA, ["push"]);

      // Pull the shared file into the feature branch
      await fetchAllRepos(env);
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Conflicting change on feature branch
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "shared.txt"), "feature version");
      await git(wtRepoA, ["add", "shared.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature change"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Conflicting change on main
      await write(join(repoA, "shared.txt"), "main version");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "main change"]);
      await git(repoA, ["push"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(result.stdout);
      expect(json.baseConflictCount).toBe(1);
      expect(json.pullConflictCount).toBe(0);
      expect(json.repos[0].predictions).toEqual({ baseConflict: true, pullConflict: false });
    }));

  test("arb status --json omits predictions when no conflicts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(result.stdout);
      expect(json.baseConflictCount).toBe(0);
      expect(json.pullConflictCount).toBe(0);
      expect(json.repos[0].predictions).toBeUndefined();
    }));

  test("arb status with mixed diverged and non-diverged repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

      // Create a shared file on main for repo-a
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "shared.txt"), "original");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "add shared"]);
      await git(repoA, ["push"]);

      // Pull into feature branch
      await fetchAllRepos(env);
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Conflicting change on feature branch for repo-a
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "shared.txt"), "feature version");
      await git(wtRepoA, ["add", "shared.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature change"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Conflicting change on main for repo-a
      await write(join(repoA, "shared.txt"), "main version");
      await git(repoA, ["add", "shared.txt"]);
      await git(repoA, ["commit", "-m", "main change"]);
      await git(repoA, ["push"]);

      // repo-b stays equal (no changes)

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
      expect(result.output).toContain("equal");
    }));
});

// ── status rebased detection ──────────────────────────────────────

describe("status rebased detection", () => {
  test("arb status shows rebased instead of push/pull after rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "file.txt"), "feature");
      await git(wtRepoA, ["add", "file.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      // Rebase feature onto advanced main
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      // Should show "from main" and "rebased" instead of misleading "to push, to pull"
      expect(result.output).toContain("from main");
      expect(result.output).toContain("rebased");
      expect(result.output).not.toContain("to pull");
    }));

  test("arb status -v shows (rebased) annotations on commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "first.txt"), "first");
      await git(wtRepoA, ["add", "first.txt"]);
      await git(wtRepoA, ["commit", "-m", "first feature"]);
      await write(join(wtRepoA, "second.txt"), "second");
      await git(wtRepoA, ["add", "second.txt"]);
      await git(wtRepoA, ["commit", "-m", "second feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      // Rebase
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "-v"], { cwd: join(env.projectDir, "my-feature") });
      // Verbose output should annotate rebased commits
      expect(result.output).toContain("(rebased)");
      expect(result.output).toContain("first feature");
      expect(result.output).toContain("second feature");
    }));
});

// ── status fast-forward intermediate detection ─────────────────────

describe("status fast-forward intermediate detection", () => {
  test("arb status shows all outdated after fast-forward pull + content-changing rewrite", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make commit A, push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Collaborator pushes B, C
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-ff-status");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["checkout", "my-feature"]);
      await write(join(tmp, "b.txt"), "b");
      await git(tmp, ["add", "b.txt"]);
      await git(tmp, ["commit", "-m", "commit b"]);
      await write(join(tmp, "c.txt"), "c");
      await git(tmp, ["add", "c.txt"]);
      await git(tmp, ["commit", "-m", "commit c"]);
      await git(tmp, ["push", "origin", "my-feature"]);
      await rm(tmp, { recursive: true });

      // Pull with fast-forward
      await git(repoA, ["pull", "--ff-only"]);

      // Rewrite with different content
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await write(join(repoA, "b.txt"), "modified-b");
      await write(join(repoA, "c.txt"), "modified-c");
      await git(repoA, ["add", "b.txt", "c.txt"]);
      await git(repoA, ["commit", "-m", "squash b+c (modified)"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      // All remote commits (B, C) should be detected as outdated via ancestry walk
      expect(result.output).toContain("outdated");
      expect(result.output).not.toContain("to pull");
    }));

  test("arb status --json shows replaced count including fast-forward intermediates", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const repoA = join(env.projectDir, "my-feature/repo-a");

      // Make commit A, push
      await write(join(repoA, "a.txt"), "a");
      await git(repoA, ["add", "a.txt"]);
      await git(repoA, ["commit", "-m", "commit a"]);
      await git(repoA, ["push", "-u", "origin", "my-feature"]);

      // Collaborator pushes B, C
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-ff-json");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["checkout", "my-feature"]);
      await write(join(tmp, "b.txt"), "b");
      await git(tmp, ["add", "b.txt"]);
      await git(tmp, ["commit", "-m", "commit b"]);
      await write(join(tmp, "c.txt"), "c");
      await git(tmp, ["add", "c.txt"]);
      await git(tmp, ["commit", "-m", "commit c"]);
      await git(tmp, ["push", "origin", "my-feature"]);
      await rm(tmp, { recursive: true });

      // Pull with fast-forward, then content-changing rewrite
      await git(repoA, ["pull", "--ff-only"]);
      await git(repoA, ["reset", "--soft", "HEAD~2"]);
      await write(join(repoA, "b.txt"), "modified-b");
      await write(join(repoA, "c.txt"), "modified-c");
      await git(repoA, ["add", "b.txt", "c.txt"]);
      await git(repoA, ["commit", "-m", "squash b+c (modified)"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "--json"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      const repo = json.repos[0];
      // Should detect all remote-only commits as replaced (2 = B + C, but not the tip which
      // may be matched by other phases — the important thing is total outdated covers them all)
      expect(repo.share.outdated).toBeTruthy();
      expect(repo.share.outdated.total).toBe(repo.share.toPull);
    }));
});

// ── status arrow separator and verbose to-pull ────────────────────

describe("status arrow separator and verbose to-pull", () => {
  test("arb status shows arrow separator between push and pull sides after rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "file.txt"), "feature");
      await git(wtRepoA, ["add", "file.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature work"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      // Rebase feature onto advanced main
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      // After rebase, the old remote commits become outdated
      expect(result.output).toContain("outdated");
    }));

  test("arb status -v shows To pull section with outdated commits after rebase", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "file.txt"), "feature");
      await git(wtRepoA, ["add", "file.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature work"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      // Rebase
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "-v"], { cwd: join(env.projectDir, "my-feature") });
      // Verbose should show "To pull from" section with the old remote commit
      expect(result.output).toContain("To pull from");
      expect(result.output).toContain("(rebased locally)");
      expect(result.output).toContain("feature work");
    }));

  test("arb status -v shows safe to force push hint when all to-pull commits are superseded", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "file.txt"), "feature");
      await git(wtRepoA, ["add", "file.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature work"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      // Rebase — all to-pull commits should be superseded (rebased locally)
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "-v"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("safe to force push");
    }));

  test("arb status -v shows genuinely new to-pull commits without superseded tag", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "local.txt"), "local work");
      await git(wtRepoA, ["add", "local.txt"]);
      await git(wtRepoA, ["commit", "-m", "local work"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate a collaborator pushing a new commit to the remote feature branch
      // Use a temporary clone to avoid worktree conflicts with the canonical repo
      const collabClone = join(env.testDir, "collab-repo-a");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), collabClone]);
      await git(collabClone, ["checkout", "my-feature"]);
      await write(join(collabClone, "collab.txt"), "collaborator");
      await git(collabClone, ["add", "collab.txt"]);
      await git(collabClone, ["commit", "-m", "collaborator commit"]);
      await git(collabClone, ["push", "origin", "my-feature"]);

      // Add another local commit so we have both toPush and toPull
      await write(join(wtRepoA, "local2.txt"), "more local");
      await git(wtRepoA, ["add", "local2.txt"]);
      await git(wtRepoA, ["commit", "-m", "more local work"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "-v"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.output).toContain("To pull from");
      expect(result.output).toContain("collaborator commit");
      // Should NOT show "safe to force push" since there's genuinely new content
      expect(result.output).not.toContain("safe to force push");
    }));

  test("arb status --json includes toPull in verbose output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "file.txt"), "feature");
      await git(wtRepoA, ["add", "file.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature work"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      // Rebase
      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "--json", "-v"], { cwd: join(env.projectDir, "my-feature") });
      const json = JSON.parse(result.stdout);
      const repo = json.repos[0];
      expect(repo.verbose.toPull).toBeDefined();
      expect(repo.verbose.toPull.length).toBeGreaterThan(0);
      expect(repo.verbose.toPull[0].superseded).toBe(true);
    }));
});

// ── compact status display ────────────────────────────────────────

describe("compact status display", () => {
  test("arb status hides BRANCH column when no repos are on wrong branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("BRANCH");
      expect(result.output).toContain("REPO");
      expect(result.output).toContain("SHARE");
    }));

  test("arb status shows BRANCH column when a repo is on wrong branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["checkout", "-b", "experiment"]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("BRANCH");
    }));

  test("arb status shows BRANCH column when a repo is detached", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      const headSha = (await git(wtRepoA, ["rev-parse", "HEAD"])).trim();
      await git(wtRepoA, ["checkout", headSha]);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("BRANCH");
    }));

  test("arb status truncates SHARE column on narrow terminal", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-long-branch-name-that-will-be-truncated", "repo-a", "repo-b"]);
      const wsCwd = join(env.projectDir, "my-long-branch-name-that-will-be-truncated");

      // Switch repo-a to a different branch so the share ref column is visible (not hidden as uniform)
      await git(join(wsCwd, "repo-a"), ["checkout", "-b", "other-branch"]);

      // First, get the untruncated width
      const fullResult = await arb(env, ["status"], { cwd: wsCwd });
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes requires matching ESC
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
      let fullWidth = 0;
      for (const line of fullResult.output.split("\n")) {
        const len = stripAnsi(line).length;
        if (len > fullWidth) fullWidth = len;
      }

      // Now run with a terminal narrower than the full width
      const narrow = fullWidth - 10;
      const proc = Bun.spawn([ARB_BIN, "status"], {
        cwd: wsCwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1", COLUMNS: String(narrow) },
      });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;
      const output = stdout + stderr;

      expect(exitCode).toBe(0);
      // The ellipsis character indicates truncation occurred
      expect(output).toContain("\u2026");
      // No content line should exceed the narrow terminal width
      let maxWidth = 0;
      for (const line of output.split("\n")) {
        const len = stripAnsi(line).length;
        if (len > maxWidth) maxWidth = len;
      }
      expect(maxWidth).toBeLessThanOrEqual(narrow);
    }));
});

// ── quiet output ──────────────────────────────────────────────────

describe("quiet output", () => {
  test("arb status -q outputs repo names only", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["status", "-q"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("REPO");
      expect(result.output).not.toContain("BRANCH");
    }));

  test("arb status --quiet --where dirty outputs only dirty repo names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--quiet", "--where", "dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --quiet --json conflicts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--quiet", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --quiet with --json");
    }));

  test("arb status --quiet --verbose conflicts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--quiet", "--verbose"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --quiet with --verbose");
    }));

  test("arb status --schema outputs valid JSON Schema without requiring workspace", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["status", "--schema"], { cwd: env.testDir });
      expect(result.exitCode).toBe(0);
      const schema = JSON.parse(result.stdout);
      expect(schema.$schema).toBeDefined();
      expect(schema.properties.repos).toBeDefined();
      expect(schema.properties.workspace).toBeDefined();
    }));

  test("arb status --schema conflicts with --json", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["status", "--schema", "--json"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Cannot combine");
    }));
});

// ── positive filter terms ─────────────────────────────────────────

describe("positive filter terms", () => {
  test("arb status --where clean shows only clean repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--quiet", "--where", "clean"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("repo-a");
    }));

  test("arb status --where safe shows repos with no at-risk flags", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--quiet", "--where", "safe"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("repo-a");
    }));
});

// ── ^ negation prefix ─────────────────────────────────────────────

describe("^ negation prefix", () => {
  test("arb status --where ^dirty matches clean repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--quiet", "--where", "^dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("repo-a");
    }));

  test("arb status --where with invalid ^term shows error", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--where", "^invalid"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown filter term");
    }));
});

// ── repo positional args ──────────────────────────────────────────

describe("repo positional args", () => {
  test("arb status with positional args filters repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["status", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status with multiple positional args filters repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["status", "repo-a", "repo-b"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb status with invalid repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "nonexistent"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not in this workspace");
    }));

  test("arb status -v with positional args shows verbose for single repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "-v", "repo-a"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("Untracked files");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status -q with positional args outputs filtered repo names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["status", "-q", "repo-a"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --json with positional args filters repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["status", "--no-fetch", "--json", "repo-a"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos.length).toBe(1);
      expect(json.repos[0].name).toBe("repo-a");
    }));

  test("arb status positional args compose with --where", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      // Filter to both repos, then --where dirty should narrow to repo-a
      const result = await arb(env, ["status", "-q", "--where", "dirty", "repo-a", "repo-b"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status reads repo names from stdin", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const wsCwd = join(env.projectDir, "my-feature");
      // Use Bun.spawn directly to pipe stdin
      const proc = Bun.spawn(["bash", "-c", `echo "repo-a" | ${ARB_BIN} status --no-fetch --json`], {
        cwd: wsCwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1" },
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.repos.length).toBe(1);
      expect(json.repos[0].name).toBe("repo-a");
    }));
});

// ── two-phase fetch rendering ─────────────────────────────────────

describe("two-phase fetch rendering", () => {
  test("arb status fetches by default and reflects fresh remote data", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "first"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Push a commit to origin from a separate clone
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);

      // Default (fetch): should see "1 to pull" after fetching fresh data
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("1 to pull");
    }));

  test("arb status --no-fetch shows stale data", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "first"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Push a commit to origin from a separate clone
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);

      // With --no-fetch, should show stale data
      const result = await arb(env, ["status", "--no-fetch"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("up to date");
    }));

  test("arb status -q skips fetch by default", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "f.txt"), "change");
      await git(wtRepoA, ["add", "f.txt"]);
      await git(wtRepoA, ["commit", "-m", "first"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Push a commit to origin from a separate clone
      const tmpClone = join(env.testDir, "tmp-clone");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpClone]);
      await git(tmpClone, ["checkout", "my-feature"]);
      await write(join(tmpClone, "r.txt"), "remote");
      await git(tmpClone, ["add", "r.txt"]);
      await git(tmpClone, ["commit", "-m", "remote commit"]);
      await git(tmpClone, ["push"]);

      // Quiet mode skips fetch by default — should not see "Fetched"
      const result = await arb(env, ["status", "-q"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("Fetched");
    }));

  test("arb status --fetch -v shows verbose detail after fetch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "file.txt"), "feature");
      await git(wtRepoA, ["add", "file.txt"]);
      await git(wtRepoA, ["commit", "-m", "feature commit"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main on origin
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream change"]);
      await git(repoA, ["push"]);

      const result = await arb(env, ["status", "--fetch", "-v"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // Should show verbose detail — the ahead-of-base commit
      expect(result.output).toContain("feature commit");
      // Should show the behind-base commit from the fetch
      expect(result.output).toContain("upstream change");
    }));

  test("arb status --fetch --json produces clean JSON", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      // Redirect stderr so fetch progress doesn't pollute JSON on stdout
      const proc = Bun.spawn([ARB_BIN, "status", "--fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1" },
      });
      const stdout = await new Response(proc.stdout).text();
      await new Response(proc.stderr).text();
      await proc.exited;
      // Output should be valid JSON
      const json = JSON.parse(stdout);
      expect(json.repos[0].name).toBe("repo-a");
    }));
});

// ── diverged commit matching ──────────────────────────────────────

describe("diverged commit matching", () => {
  test("arb status does not detect PR from fast-forward merge", () =>
    withEnv(async (env) => {
      // Fast-forward merges produce no merge commit, so parentage-based detection
      // cannot find a merge commit. This is a known limitation (decision 0048).
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat(repos): add seeder repository (#188)"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Fast-forward merge into main (no merge commit)
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["merge", "origin/my-feature", "--ff-only"]);
      await git(repoA, ["push"]);
      // Delete the remote branch so status detects "gone"
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");

      // No PR should be detected — fast-forward merges have no merge commit
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge.detectedPr).toBeUndefined();
    }));

  test("arb status detects PR number from merge commit", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Merge with --no-ff to produce a merge commit with PR number in subject
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["merge", "origin/my-feature", "--no-ff", "-m", "Merge pull request #42 from user/my-feature"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("(#42)");

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge.detectedPr.number).toBe(42);
    }));

  test("arb status detects PR from merge commit via parentage", () =>
    withEnv(async (env) => {
      // The merge commit subject does NOT contain the branch name but DOES contain a PR number.
      // Parentage-based detection finds the merge commit because HEAD is its second parent.
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Merge with --no-ff but a generic subject that does NOT contain "my-feature"
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, [
        "merge",
        "origin/my-feature",
        "--no-ff",
        "-m",
        "Merge pull request #77 from user/some-renamed-branch",
      ]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("(#77)");

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge.detectedPr.number).toBe(77);
    }));

  test("arb status detects PR number from squash merge commit", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Squash merge with PR number in subject (GitHub squash merge format)
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["merge", "--squash", "origin/my-feature"]);
      await git(repoA, ["commit", "-m", "feat: add feature (#55)"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("(#55)");

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge.detectedPr.number).toBe(55);
    }));

  test("arb status detects MR number from GitLab squash merge commit", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Squash merge with MR number in subject (GitLab squash merge format)
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["merge", "--squash", "origin/my-feature"]);
      await git(repoA, ["commit", "-m", "feat: add feature (!55)"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("(#55)");

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge.detectedPr.number).toBe(55);
    }));

  test("arb status detects PR via ticket fallback", () =>
    withEnv(async (env) => {
      // Branch name contains ticket PROJ-99; the commit subject references PROJ-99 with a PR number.
      // Merge commit search fails (no merge commit mentioning "proj-99-feature" in subject),
      // but findTicketReferencedCommit finds the commit because it references PROJ-99.
      await arb(env, ["create", "proj-99-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "proj-99-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: resolve PROJ-99 issue (#77)"]);
      await git(wtRepoA, ["push", "-u", "origin", "proj-99-feature"]);

      // Merge with --no-ff but use a generic subject that does NOT mention the branch name
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["merge", "origin/proj-99-feature", "--no-ff", "-m", "Merge branch into main"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "proj-99-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "proj-99-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("(#77)");

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "proj-99-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge.detectedPr.number).toBe(77);
    }));

  test("arb status detects PR via ticket fallback on squash merge", () =>
    withEnv(async (env) => {
      // Branch name contains ticket PROJ-99; the squash commit references PROJ-99 with a PR number.
      // The squash commit subject has no (#N) or (!N) pattern, so extractPrNumber returns null.
      // The ticket fallback kicks in: detectTicketFromName finds PROJ-99, then
      // findTicketReferencedCommit finds the commit referencing PROJ-99 with a PR number.
      await arb(env, ["create", "proj-99-squash", "repo-a"]);
      const wtRepoA = join(env.projectDir, "proj-99-squash/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: resolve PROJ-99 issue (#88)"]);
      await git(wtRepoA, ["push", "-u", "origin", "proj-99-squash"]);

      // Squash merge with a generic subject that does NOT contain (#N) or (!N)
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["merge", "--squash", "origin/proj-99-squash"]);
      await git(repoA, ["commit", "-m", "feat: resolve PROJ-99 issue"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "proj-99-squash"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "proj-99-squash") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("(#88)");

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "proj-99-squash"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge.detectedPr.number).toBe(88);
    }));

  // ── pull-merge false positive ──────────────────────────────────

  describe("pull-merge false positive", () => {
    test("reset + pull does not show merged", () =>
      withEnv(async (env) => {
        await arb(env, ["create", "my-feature", "repo-a"]);
        const wtRepoA = join(env.projectDir, "my-feature/repo-a");

        // Push a feature commit
        await write(join(wtRepoA, "feature.txt"), "feature");
        await git(wtRepoA, ["add", "feature.txt"]);
        await git(wtRepoA, ["commit", "-m", "feature work"]);
        await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

        // Advance main on origin so base and feature diverge
        const repoA = join(env.projectDir, ".arb/repos/repo-a");
        await write(join(repoA, "upstream.txt"), "upstream");
        await git(repoA, ["add", "upstream.txt"]);
        await git(repoA, ["commit", "-m", "upstream"]);
        await git(repoA, ["push"]);

        // Simulate `arb reset`: reset worktree to origin/main
        await git(wtRepoA, ["fetch", "origin"]);
        await git(wtRepoA, ["reset", "--hard", "origin/main"]);

        // Simulate `arb pull`: pull from origin/my-feature (creates three-way merge)
        await git(wtRepoA, ["-c", "pull.rebase=false", "pull", "origin", "my-feature", "--no-edit"]);

        await fetchAllRepos(env);
        const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
        expect(result.exitCode).toBe(0);
        expect(result.output).not.toContain("merged");

        // Verify JSON output
        const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
          cwd: join(env.projectDir, "my-feature"),
        });
        const json = JSON.parse(jsonResult.stdout);
        expect(json.repos[0].base.merge).toBeUndefined();
      }));

    test("FF merge + new commit still shows merged", () =>
      withEnv(async (env) => {
        await arb(env, ["create", "my-feature", "repo-a"]);
        const wtRepoA = join(env.projectDir, "my-feature/repo-a");

        // Push a feature commit
        await write(join(wtRepoA, "feature.txt"), "feature");
        await git(wtRepoA, ["add", "feature.txt"]);
        await git(wtRepoA, ["commit", "-m", "feature work"]);
        await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

        // FF merge into main on origin (keep remote branch so prefix loop has toPush-based limit)
        const repoA = join(env.projectDir, ".arb/repos/repo-a");
        await git(repoA, ["merge", "origin/my-feature"]);
        await git(repoA, ["push"]);

        // Add a new commit locally on the feature branch
        await write(join(wtRepoA, "extra.txt"), "extra");
        await git(wtRepoA, ["add", "extra.txt"]);
        await git(wtRepoA, ["commit", "-m", "extra commit"]);

        await fetchAllRepos(env);
        const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
          cwd: join(env.projectDir, "my-feature"),
        });
        const json = JSON.parse(jsonResult.stdout);
        expect(json.repos[0].base.merge.kind).toBe("merge");
        expect(json.repos[0].base.merge.newCommitsAfter).toBe(1);
      }));

    test("non-FF merge + new commit still shows merged", () =>
      withEnv(async (env) => {
        await arb(env, ["create", "my-feature", "repo-a"]);
        const wtRepoA = join(env.projectDir, "my-feature/repo-a");

        // Push a feature commit
        await write(join(wtRepoA, "feature.txt"), "feature");
        await git(wtRepoA, ["add", "feature.txt"]);
        await git(wtRepoA, ["commit", "-m", "feature work"]);
        await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

        // Merge into main with --no-ff (keep remote branch so prefix loop has toPush-based limit)
        const repoA = join(env.projectDir, ".arb/repos/repo-a");
        await git(repoA, ["merge", "origin/my-feature", "--no-ff", "-m", "Merge my-feature into main"]);
        await git(repoA, ["push"]);

        // Add a new commit locally on the feature branch
        await write(join(wtRepoA, "extra.txt"), "extra");
        await git(wtRepoA, ["add", "extra.txt"]);
        await git(wtRepoA, ["commit", "-m", "extra commit"]);

        await fetchAllRepos(env);
        const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
          cwd: join(env.projectDir, "my-feature"),
        });
        const json = JSON.parse(jsonResult.stdout);
        expect(json.repos[0].base.merge.kind).toBe("merge");
      }));

    test("squash merge + new commit still shows merged", () =>
      withEnv(async (env) => {
        await arb(env, ["create", "my-feature", "repo-a"]);
        const wtRepoA = join(env.projectDir, "my-feature/repo-a");

        // Push a feature commit
        await write(join(wtRepoA, "feature.txt"), "feature");
        await git(wtRepoA, ["add", "feature.txt"]);
        await git(wtRepoA, ["commit", "-m", "feature work"]);
        await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

        // Squash merge into main
        const repoA = join(env.projectDir, ".arb/repos/repo-a");
        await git(repoA, ["merge", "--squash", "origin/my-feature"]);
        await git(repoA, ["commit", "-m", "squash merge my-feature"]);
        await git(repoA, ["push"]);
        // Delete remote branch
        await git(join(env.originDir, "repo-a.git"), ["branch", "-D", "my-feature"]);
        await git(repoA, ["fetch", "--prune"]);

        // Add a new commit locally on the feature branch
        await write(join(wtRepoA, "extra.txt"), "extra");
        await git(wtRepoA, ["add", "extra.txt"]);
        await git(wtRepoA, ["commit", "-m", "extra commit"]);

        await fetchAllRepos(env);
        const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
          cwd: join(env.projectDir, "my-feature"),
        });
        const json = JSON.parse(jsonResult.stdout);
        expect(json.repos[0].base.merge.kind).toBe("squash");
      }));

    test("reset + pull with multiple repos", () =>
      withEnv(async (env) => {
        await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);

        for (const repo of ["repo-a", "repo-b"]) {
          const wt = join(env.projectDir, "my-feature", repo);

          // Push a feature commit
          await write(join(wt, "feature.txt"), "feature");
          await git(wt, ["add", "feature.txt"]);
          await git(wt, ["commit", "-m", "feature work"]);
          await git(wt, ["push", "-u", "origin", "my-feature"]);

          // Advance main on origin
          const canonical = join(env.projectDir, ".arb/repos", repo);
          await write(join(canonical, "upstream.txt"), "upstream");
          await git(canonical, ["add", "upstream.txt"]);
          await git(canonical, ["commit", "-m", "upstream"]);
          await git(canonical, ["push"]);

          // Simulate reset + pull
          await git(wt, ["fetch", "origin"]);
          await git(wt, ["reset", "--hard", "origin/main"]);
          await git(wt, ["-c", "pull.rebase=false", "pull", "origin", "my-feature", "--no-edit"]);
        }

        await fetchAllRepos(env);
        const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
        expect(result.exitCode).toBe(0);
        expect(result.output).not.toContain("merged");
      }));
  });
});

test("arb status -v shows (same as ...) when feature commit is cherry-picked onto base", () =>
  withEnv(async (env) => {
    await arb(env, ["create", "my-feature", "repo-a"]);
    const wtRepoA = join(env.projectDir, "my-feature/repo-a");
    await write(join(wtRepoA, "feature.txt"), "feature");
    await git(wtRepoA, ["add", "feature.txt"]);
    await git(wtRepoA, ["commit", "-m", "feature work"]);
    await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

    // Cherry-pick the feature commit onto main (with a diverging commit first)
    const featureSha = (await git(wtRepoA, ["rev-parse", "HEAD"])).trim();
    const repoA = join(env.projectDir, ".arb/repos/repo-a");
    await write(join(repoA, "upstream.txt"), "upstream");
    await git(repoA, ["add", "upstream.txt"]);
    await git(repoA, ["commit", "-m", "upstream work"]);
    await git(repoA, ["cherry-pick", featureSha]);
    await git(repoA, ["push"]);

    await fetchAllRepos(env);
    const result = await arb(env, ["status", "-v"], { cwd: join(env.projectDir, "my-feature") });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("(same as");
    expect(result.output).toContain("feature work");
  }));

// ── status JSON: diverged share with outdated detection ──────────

describe("status JSON: diverged share with outdated detection", () => {
  test("arb status --json detects rebased commits in diverged share", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Advance main and rebase locally
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      await arb(env, ["rebase", "--yes"], { cwd: join(env.projectDir, "my-feature") });

      // Now local is rebased but remote still has old commits → diverged share
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      const repo = json.repos[0];
      // Share should show toPush > 0 and toPull > 0 (diverged)
      expect(repo.share.toPush).toBeGreaterThan(0);
      expect(repo.share.toPull).toBeGreaterThan(0);
      // Outdated should detect the rebased commits
      expect(repo.share.outdated).toBeDefined();
      expect(repo.share.outdated.rebased).toBeGreaterThan(0);
    }));

  test("arb status --json shows base ahead/behind after upstream change", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: add feature"]);

      // Advance main
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "upstream.txt"), "upstream");
      await git(repoA, ["add", "upstream.txt"]);
      await git(repoA, ["commit", "-m", "upstream"]);
      await git(repoA, ["push"]);

      await fetchAllRepos(env);
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      const repo = json.repos[0];
      expect(repo.base.ahead).toBe(1); // 1 local commit ahead of base
      expect(repo.base.behind).toBe(1); // 1 upstream commit behind
    }));

  test("arb status --json shows detached HEAD identity", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");
      await write(join(wtRepoA, "file.txt"), "content");
      await git(wtRepoA, ["add", "file.txt"]);
      await git(wtRepoA, ["commit", "-m", "commit"]);
      // Detach HEAD
      await git(wtRepoA, ["checkout", "--detach"]);

      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      const repo = json.repos[0];
      expect(repo.identity.headMode.kind).toBe("detached");
    }));
});

// ── rebase-merge detection via replay plan ──────────────────────

describe("rebase-merge detection", () => {
  test("branch with all commits rebase-merged onto base shows merged (multi-commit)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");

      // Create multiple commits on the feature branch
      await write(join(wtRepoA, "file1.txt"), "feature-1");
      await git(wtRepoA, ["add", "file1.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: first change"]);
      await write(join(wtRepoA, "file2.txt"), "feature-2");
      await git(wtRepoA, ["add", "file2.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: second change"]);
      await write(join(wtRepoA, "file3.txt"), "feature-3");
      await git(wtRepoA, ["add", "file3.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: third change"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate rebase-merge: recreate same changes on main with different SHAs
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "file1.txt"), "feature-1");
      await git(repoA, ["add", "file1.txt"]);
      await git(repoA, ["commit", "-m", "feat: first change", "--date=2020-01-01T00:00:00"]);
      await write(join(repoA, "file2.txt"), "feature-2");
      await git(repoA, ["add", "file2.txt"]);
      await git(repoA, ["commit", "-m", "feat: second change", "--date=2020-01-01T00:00:01"]);
      await write(join(repoA, "file3.txt"), "feature-3");
      await git(repoA, ["add", "file3.txt"]);
      await git(repoA, ["commit", "-m", "feat: third change", "--date=2020-01-01T00:00:02"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "--no-fetch"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge).toBeDefined();
      expect(json.repos[0].base.merge.kind).toBe("merge");
    }));

  test("branch with single commit rebase-merged onto base shows merged", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");

      await write(join(wtRepoA, "feature.txt"), "feature");
      await git(wtRepoA, ["add", "feature.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: the change"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Recreate same change on main with different SHA
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "feature.txt"), "feature");
      await git(repoA, ["add", "feature.txt"]);
      await git(repoA, ["commit", "-m", "feat: the change", "--date=2020-01-01T00:00:00"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      await fetchAllRepos(env);
      const result = await arb(env, ["status", "--no-fetch"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged");
    }));

  test("rebase-merged branch with new commit shows 'merged, N ahead'", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wtRepoA = join(env.projectDir, "my-feature/repo-a");

      // Create 2 commits on the feature branch
      await write(join(wtRepoA, "file1.txt"), "feature-1");
      await git(wtRepoA, ["add", "file1.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: first change"]);
      await write(join(wtRepoA, "file2.txt"), "feature-2");
      await git(wtRepoA, ["add", "file2.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: second change"]);
      await git(wtRepoA, ["push", "-u", "origin", "my-feature"]);

      // Simulate rebase-merge: recreate the same changes on main with different SHAs.
      // Use GIT_COMMITTER_DATE to force different commit hashes.
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await write(join(repoA, "file1.txt"), "feature-1");
      await git(repoA, ["add", "file1.txt"]);
      await git(repoA, ["commit", "-m", "feat: first change", "--date=2020-01-01T00:00:00"]);
      await write(join(repoA, "file2.txt"), "feature-2");
      await git(repoA, ["add", "file2.txt"]);
      await git(repoA, ["commit", "-m", "feat: second change", "--date=2020-01-01T00:00:01"]);
      await git(repoA, ["push"]);
      await git(repoA, ["push", "origin", "--delete", "my-feature"]);

      // Add a new commit on top of the merged branch
      await write(join(wtRepoA, "file3.txt"), "new-work");
      await git(wtRepoA, ["add", "file3.txt"]);
      await git(wtRepoA, ["commit", "-m", "feat: new work after merge"]);

      await fetchAllRepos(env);

      // Verify JSON output
      const jsonResult = await arb(env, ["status", "--no-fetch", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      const json = JSON.parse(jsonResult.stdout);
      expect(json.repos[0].base.merge).toBeDefined();
      expect(json.repos[0].base.merge.kind).toBe("merge");
      expect(json.repos[0].base.merge.newCommitsAfter).toBe(1);

      // Verify table output
      const result = await arb(env, ["status", "--no-fetch"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("merged, 1 ahead");
    }));
});
