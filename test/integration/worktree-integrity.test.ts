import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, gitBelow230, withEnv } from "./helpers/env";

describe("worktree integrity", () => {
  test("scoped prune does not destroy other workspaces' entries", () =>
    withEnv(async (env) => {
      // Create two workspaces both using repo-a
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-a"]);

      // Verify both worktrees exist
      expect(existsSync(join(env.projectDir, "ws-one/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "ws-two/repo-a"))).toBe(true);

      // Delete ws-one's repo dir (simulating agent deleting it)
      await rm(join(env.projectDir, "ws-one/repo-a"), { recursive: true });

      // Create a third workspace — this triggers pruneWorktreeEntriesForDir
      // which should only prune entries for ws-three, NOT ws-one's stale entry
      await arb(env, ["create", "ws-three", "repo-a"]);

      // ws-two should still have a valid worktree — its entry must not have been pruned
      const wsTwo = join(env.projectDir, "ws-two/repo-a");
      expect(existsSync(wsTwo)).toBe(true);
      const gitContent = readFileSync(join(wsTwo, ".git"), "utf-8").trim();
      expect(gitContent.startsWith("gitdir: ")).toBe(true);

      // The gitdir entry should still point back to ws-two
      const gitdirPath = gitContent.slice("gitdir: ".length);
      const backRef = readFileSync(join(gitdirPath, "gitdir"), "utf-8").trim();
      expect(backRef).toBe(join(wsTwo, ".git"));
    }));

  test("stale .git reference is detected and worktree is recreated", () =>
    withEnv(async (env) => {
      // Create two workspaces with repo-a
      await arb(env, ["create", "ws-first", "repo-a"]);
      await arb(env, ["create", "ws-second", "repo-a"]);

      const wsFirstRepo = join(env.projectDir, "ws-first/repo-a");

      // Delete ws-first's repo dir and prune (simulating the bug scenario)
      await rm(wsFirstRepo, { recursive: true });
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);

      // Recreate the directory manually with a stale .git file
      await mkdir(wsFirstRepo, { recursive: true });
      // Point it to ws-second's worktree entry (simulating the corruption)
      const wsSecondGitContent = readFileSync(join(env.projectDir, "ws-second/repo-a/.git"), "utf-8").trim();
      writeFileSync(join(wsFirstRepo, ".git"), wsSecondGitContent);

      // Now re-attach repo-a to ws-first — should detect the stale ref and recreate
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-first") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("stale worktree reference");

      // ws-first should now have its own valid worktree entry
      const newGitContent = readFileSync(join(wsFirstRepo, ".git"), "utf-8").trim();
      expect(newGitContent.startsWith("gitdir: ")).toBe(true);
      const newGitdirPath = newGitContent.slice("gitdir: ".length);
      const backRef = readFileSync(join(newGitdirPath, "gitdir"), "utf-8").trim();
      expect(backRef).toBe(join(wsFirstRepo, ".git"));

      // And it should NOT share ws-second's entry
      expect(newGitContent).not.toBe(wsSecondGitContent);
    }));

  test("shared worktree entry — stale side is auto-repaired on command run", () =>
    withEnv(async (env) => {
      // Create two workspaces with repo-a
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-a"]);

      // Corrupt ws-alpha to point to ws-beta's worktree entry (ws-alpha becomes the stale side)
      const wsBetaGitContent = readFileSync(join(env.projectDir, "ws-beta/repo-a/.git"), "utf-8").trim();
      writeFileSync(join(env.projectDir, "ws-alpha/repo-a/.git"), wsBetaGitContent);

      // Run status in ws-alpha — should auto-repair by removing the stale .git file
      const result = await arb(env, ["-C", join(env.projectDir, "ws-alpha"), "status", "-N"]);
      expect(result.output).toContain("removed stale worktree reference");

      // ws-alpha/repo-a directory should still exist (may contain uncommitted work)
      // but the .git file should be gone
      expect(existsSync(join(env.projectDir, "ws-alpha/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "ws-alpha/repo-a/.git"))).toBe(false);

      // ws-beta should still be fine
      const betaResult = await arb(env, ["-C", join(env.projectDir, "ws-beta"), "status", "-N"]);
      expect(betaResult.exitCode).toBe(0);
      expect(betaResult.output).not.toContain("stale");
      expect(betaResult.output).not.toContain("shared");
    }));

  test("shared worktree entry — owner side warns about other workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-owner", "repo-a"]);
      await arb(env, ["create", "ws-stale", "repo-a"]);

      // Make ws-stale point to ws-owner's worktree entry
      const wsOwnerGitContent = readFileSync(join(env.projectDir, "ws-owner/repo-a/.git"), "utf-8").trim();
      writeFileSync(join(env.projectDir, "ws-stale/repo-a/.git"), wsOwnerGitContent);

      // Run status from ws-owner (the owner side) — should warn about the other workspace
      const result = await arb(env, ["-C", join(env.projectDir, "ws-owner"), "status", "-N"]);
      expect(result.output).toContain("worktree entry shared with ws-stale");
    }));

  test("valid worktree directory is correctly skipped without stale warning", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-ok", "repo-a"]);

      // Attach repo-a again — should skip with "already exists", NOT "stale"
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-ok") });
      expect(result.output).toContain("already exists");
      expect(result.output).not.toContain("stale");
    }));

  test("detach+attach cycle resolves shared entry", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-a", "repo-a"]);
      await arb(env, ["create", "ws-b", "repo-a"]);

      // Corrupt: make ws-a point to ws-b's worktree entry
      const wsBGitContent = readFileSync(join(env.projectDir, "ws-b/repo-a/.git"), "utf-8").trim();
      writeFileSync(join(env.projectDir, "ws-a/repo-a/.git"), wsBGitContent);

      // Detach from ws-a — auto-repair removes stale dir, detach sees "not in workspace"
      await arb(env, ["detach", "repo-a", "--force", "--yes", "-N"], { cwd: join(env.projectDir, "ws-a") });

      // Attach to ws-a — should create a new, non-shared entry
      const attachResult = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-a") });
      expect(attachResult.exitCode).toBe(0);

      // Verify ws-a has its own valid entry
      const wsAGit = readFileSync(join(env.projectDir, "ws-a/repo-a/.git"), "utf-8").trim();
      const wsBGit = readFileSync(join(env.projectDir, "ws-b/repo-a/.git"), "utf-8").trim();
      expect(wsAGit).not.toBe(wsBGit);

      // Both should have valid back-refs
      const wsAGitdir = wsAGit.slice("gitdir: ".length);
      const wsABackRef = readFileSync(join(wsAGitdir, "gitdir"), "utf-8").trim();
      expect(wsABackRef).toBe(join(env.projectDir, "ws-a/repo-a/.git"));

      const wsBGitdir = wsBGit.slice("gitdir: ".length);
      const wsBBackRef = readFileSync(join(wsBGitdir, "gitdir"), "utf-8").trim();
      expect(wsBBackRef).toBe(join(env.projectDir, "ws-b/repo-a/.git"));
    }));

  test("detach fallback does not run global prune", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-keep", "repo-a"]);
      await arb(env, ["create", "ws-fix", "repo-a"]);

      // Save ws-keep's gitdir info before deleting
      const wsKeepGit = readFileSync(join(env.projectDir, "ws-keep/repo-a/.git"), "utf-8").trim();
      const wsKeepGitdir = wsKeepGit.slice("gitdir: ".length);

      // Delete ws-keep's repo dir (simulate temporary absence)
      await rm(join(env.projectDir, "ws-keep/repo-a"), { recursive: true });

      // Detach from ws-fix — the fallback should use scoped pruning
      await arb(env, ["detach", "repo-a", "--yes", "-N"], { cwd: join(env.projectDir, "ws-fix") });

      // ws-keep's worktree entry should still exist in the canonical repo
      // (global prune would have removed it since ws-keep/repo-a is gone)
      expect(existsSync(wsKeepGitdir)).toBe(true);
    }));

  test("detach with invalid worktree ref skips git worktree remove", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-good", "repo-a"]);
      await arb(env, ["create", "ws-bad", "repo-a"]);

      // Corrupt ws-bad to point to ws-good's entry
      const wsGoodGitContent = readFileSync(join(env.projectDir, "ws-good/repo-a/.git"), "utf-8").trim();
      writeFileSync(join(env.projectDir, "ws-bad/repo-a/.git"), wsGoodGitContent);

      // Detach from ws-bad — should succeed (auto-repair removes stale dir first)
      const result = await arb(env, ["detach", "repo-a", "--force", "--yes", "-N"], {
        cwd: join(env.projectDir, "ws-bad"),
      });
      expect(result.exitCode).toBe(0);

      // ws-good should still work fine (its entry was not touched)
      const goodResult = await arb(env, ["-C", join(env.projectDir, "ws-good"), "status", "-N"]);
      expect(goodResult.exitCode).toBe(0);
      const goodGit = readFileSync(join(env.projectDir, "ws-good/repo-a/.git"), "utf-8").trim();
      const goodGitdir = goodGit.slice("gitdir: ".length);
      const backRef = readFileSync(join(goodGitdir, "gitdir"), "utf-8").trim();
      expect(backRef).toBe(join(env.projectDir, "ws-good/repo-a/.git"));
    }));

  test("attach cleans up stale collision refs in other workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-victim", "repo-a"]);
      await arb(env, ["create", "ws-culprit", "repo-a"]);

      // Save ws-victim's gitdir path
      const victimGit = readFileSync(join(env.projectDir, "ws-victim/repo-a/.git"), "utf-8").trim();

      // Detach repo-a from ws-culprit
      await arb(env, ["detach", "repo-a", "--yes", "-N"], { cwd: join(env.projectDir, "ws-culprit") });

      // Simulate the corruption scenario: prune ws-victim's entry, then recreate
      // a stale .git file that will collide when ws-culprit re-attaches
      await rm(join(env.projectDir, "ws-victim/repo-a"), { recursive: true });
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);

      // Recreate ws-victim dir with stale .git pointing to the old entry name
      await mkdir(join(env.projectDir, "ws-victim/repo-a"), { recursive: true });
      writeFileSync(join(env.projectDir, "ws-victim/repo-a/.git"), victimGit);

      // Re-attach to ws-culprit — if the new entry reuses the name,
      // cleanupWorktreeCollisions should remove ws-victim's stale .git
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-culprit") });
      expect(result.exitCode).toBe(0);

      // ws-culprit should have a valid, non-shared entry
      const culpritGit = readFileSync(join(env.projectDir, "ws-culprit/repo-a/.git"), "utf-8").trim();
      const culpritGitdir = culpritGit.slice("gitdir: ".length);
      const backRef = readFileSync(join(culpritGitdir, "gitdir"), "utf-8").trim();
      expect(backRef).toBe(join(env.projectDir, "ws-culprit/repo-a/.git"));

      // ws-victim's stale .git should have been cleaned up (if collision occurred)
      // or not exist at all
      if (existsSync(join(env.projectDir, "ws-victim/repo-a/.git"))) {
        // If the .git file still exists, it should not point to ws-culprit's entry
        const victimGitNow = readFileSync(join(env.projectDir, "ws-victim/repo-a/.git"), "utf-8").trim();
        expect(victimGitNow).not.toBe(culpritGit);
      }
    }));

  test.skipIf(gitBelow230)("project directory move is auto-repaired", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-move", "repo-a"]);

      // Verify worktree works before move
      const beforeResult = await arb(env, ["-C", join(env.projectDir, "ws-move"), "status", "-N"]);
      expect(beforeResult.exitCode).toBe(0);

      // Move the entire project directory
      const newProjectDir = join(env.testDir, "moved-project");
      await rename(env.projectDir, newProjectDir);

      // Run status from the moved location — should auto-repair
      const result = await arb({ ...env, projectDir: newProjectDir }, [
        "-C",
        join(newProjectDir, "ws-move"),
        "status",
        "-N",
      ]);
      expect(result.exitCode).toBe(0);

      // Verify forward ref now points to new location
      const gitContent = readFileSync(join(newProjectDir, "ws-move/repo-a/.git"), "utf-8").trim();
      expect(gitContent).toContain(newProjectDir);
      expect(gitContent).not.toContain(env.projectDir);

      // Verify backward ref also points to new location
      const gitdirPath = gitContent.slice("gitdir: ".length);
      const backRef = readFileSync(join(gitdirPath, "gitdir"), "utf-8").trim();
      expect(backRef).toBe(join(newProjectDir, "ws-move/repo-a/.git"));

      // Update env so cleanup works
      env.projectDir = newProjectDir;
    }),
  );

  test.skipIf(gitBelow230)("project move detection is skipped when old path still exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-safe", "repo-a"]);

      // Copy (not move) the project — old path still exists
      const copyDir = join(env.testDir, "copy-project");
      await cp(env.projectDir, copyDir, { recursive: true });

      // The copy's forward refs point to the original (which exists),
      // so detection should NOT trigger
      const origGitBefore = readFileSync(join(env.projectDir, "ws-safe/repo-a/.git"), "utf-8");

      // Verify the copy's forward ref points to the original (not rewritten
      // to the copy) — confirming detection was skipped before any command runs
      const copyGit = readFileSync(join(copyDir, "ws-safe/repo-a/.git"), "utf-8").trim();
      expect(copyGit).toContain(env.projectDir);
      expect(copyGit).not.toContain(copyDir);

      await arb({ ...env, projectDir: copyDir }, ["-C", join(copyDir, "ws-safe"), "status", "-N"]);

      // Original refs stay untouched
      const origGitAfter = readFileSync(join(env.projectDir, "ws-safe/repo-a/.git"), "utf-8");
      expect(origGitAfter).toBe(origGitBefore);
    }),
  );

  test("targeted stale entry removal unblocks worktree add", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-stale", "repo-a"]);

      // Delete the workspace repo dir to make its worktree entry stale
      await rm(join(env.projectDir, "ws-stale/repo-a"), { recursive: true });

      // Re-attach — removeStaleEntryAtPath should find and remove the stale entry
      // allowing git worktree add to succeed
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-stale") });
      expect(result.exitCode).toBe(0);

      // Should have a valid worktree
      const gitContent = readFileSync(join(env.projectDir, "ws-stale/repo-a/.git"), "utf-8").trim();
      expect(gitContent.startsWith("gitdir: ")).toBe(true);
      const gitdirPath = gitContent.slice("gitdir: ".length);
      const backRef = readFileSync(join(gitdirPath, "gitdir"), "utf-8").trim();
      expect(backRef).toBe(join(env.projectDir, "ws-stale/repo-a/.git"));
    }));

  test("attach re-links when directory has files and no .git", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-relink", "repo-a"]);

      const repoDir = join(env.projectDir, "ws-relink/repo-a");

      // Write a local file (simulate uncommitted user work)
      writeFileSync(join(repoDir, "local-change.txt"), "important work");

      // Remove the .git file and prune entries (simulate post-auto-repair state)
      await rm(join(repoDir, ".git"));
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["worktree", "prune"]);

      // Attach — should re-link in place instead of failing
      const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-relink") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("re-linking stale worktree in place —");

      // Worktree should have valid bidirectional references
      const gitContent = readFileSync(join(repoDir, ".git"), "utf-8").trim();
      expect(gitContent.startsWith("gitdir: ")).toBe(true);
      const gitdirPath = gitContent.slice("gitdir: ".length);
      const backRef = readFileSync(join(gitdirPath, "gitdir"), "utf-8").trim();
      expect(backRef).toBe(join(repoDir, ".git"));

      // User's file should still be there
      expect(readFileSync(join(repoDir, "local-change.txt"), "utf-8")).toBe("important work");
    }));

  test("attach re-links after shared-entry auto-repair", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-a"]);

      const wsOneRepo = join(env.projectDir, "ws-one/repo-a");
      const wsTwoRepo = join(env.projectDir, "ws-two/repo-a");

      // Write a file in ws-one (simulate user work)
      writeFileSync(join(wsOneRepo, "local-change.txt"), "my changes");

      // Corrupt ws-one to point to ws-two's worktree entry (shared entry scenario)
      const wsTwoGitContent = readFileSync(join(wsTwoRepo, ".git"), "utf-8").trim();
      writeFileSync(join(wsOneRepo, ".git"), wsTwoGitContent);

      // Run status in ws-one — triggers auto-repair (removes stale .git)
      const statusResult = await arb(env, ["-C", join(env.projectDir, "ws-one"), "status", "-N"]);
      expect(statusResult.output).toContain("removed stale worktree reference");
      expect(existsSync(join(wsOneRepo, ".git"))).toBe(false);

      // Attach repo-a to ws-one — should re-link in place
      const attachResult = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-one") });
      expect(attachResult.exitCode).toBe(0);
      expect(attachResult.output).toContain("re-linking stale worktree in place —");

      // ws-one should have its own valid worktree entry
      const wsOneGit = readFileSync(join(wsOneRepo, ".git"), "utf-8").trim();
      expect(wsOneGit.startsWith("gitdir: ")).toBe(true);
      const wsOneGitdir = wsOneGit.slice("gitdir: ".length);
      const wsOneBackRef = readFileSync(join(wsOneGitdir, "gitdir"), "utf-8").trim();
      expect(wsOneBackRef).toBe(join(wsOneRepo, ".git"));

      // ws-two should still be valid and independent
      const wsTwoGit = readFileSync(join(wsTwoRepo, ".git"), "utf-8").trim();
      const wsTwoGitdir = wsTwoGit.slice("gitdir: ".length);
      const wsTwoBackRef = readFileSync(join(wsTwoGitdir, "gitdir"), "utf-8").trim();
      expect(wsTwoBackRef).toBe(join(wsTwoRepo, ".git"));
      expect(wsOneGit).not.toBe(wsTwoGit);

      // User's file should be preserved
      expect(readFileSync(join(wsOneRepo, "local-change.txt"), "utf-8")).toBe("my changes");
    }));

  // git worktree repair requires git 2.30+
  test.skipIf(gitBelow230)("arb status works after worktree back-reference is corrupted", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const wsRepo = join(env.projectDir, "my-feature/repo-a");

      // Read the .git file to find the worktree entry
      const gitContent = readFileSync(join(wsRepo, ".git"), "utf-8").trim();
      const gitdirPath = gitContent.slice("gitdir: ".length);

      // Corrupt the back-reference (gitdir file in the worktree entry)
      writeFileSync(join(gitdirPath, "gitdir"), "/nonexistent/path/.git\n");

      // Status should detect and repair the broken back-reference
      const result = await arb(env, ["status"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");

      // Verify the back-reference was repaired
      const repairedBackRef = readFileSync(join(gitdirPath, "gitdir"), "utf-8").trim();
      expect(repairedBackRef).toBe(join(wsRepo, ".git"));
    }),
  );
});
