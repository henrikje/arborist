import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, setupForkRepo, withEnv, write } from "./helpers/env";

// ── fork workflow (multiple remotes) ─────────────────────────────

describe("fork workflow (multiple remotes)", () => {
	test("arb repo clone --upstream sets up fork layout", () =>
		withEnv(async (env) => {
			await mkdir(join(env.testDir, "upstream"), { recursive: true });
			await git(env.testDir, ["init", "--bare", join(env.testDir, "upstream/clone-fork.git"), "-b", "main"]);
			const tmpClone = join(env.testDir, "tmp-clone-fork");
			await git(env.testDir, ["clone", join(env.testDir, "upstream/clone-fork.git"), tmpClone]);
			await git(tmpClone, ["commit", "--allow-empty", "-m", "init"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });
			await mkdir(join(env.testDir, "fork"), { recursive: true });
			await git(env.testDir, [
				"clone",
				"--bare",
				join(env.testDir, "upstream/clone-fork.git"),
				join(env.testDir, "fork/clone-fork.git"),
			]);

			const result = await arb(env, [
				"repo",
				"clone",
				join(env.testDir, "fork/clone-fork.git"),
				"clone-fork",
				"--upstream",
				join(env.testDir, "upstream/clone-fork.git"),
			]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/clone-fork/.git"))).toBe(true);

			// Verify remotes are set up
			const remotes = await git(join(env.projectDir, ".arb/repos/clone-fork"), ["remote"]);
			expect(remotes).toContain("origin");
			expect(remotes).toContain("upstream");

			// Verify remote.pushDefault
			const pushDefault = await git(join(env.projectDir, ".arb/repos/clone-fork"), ["config", "remote.pushDefault"]);
			expect(pushDefault.trim()).toBe("origin");
		}));

	test("fork: create workspace branches from upstream", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");

			// Add a commit to upstream that fork doesn't have
			const tmpClone = join(env.testDir, "tmp-upstream-commit");
			await git(env.testDir, ["clone", join(env.testDir, "upstream/repo-a.git"), tmpClone]);
			await write(join(tmpClone, "upstream.txt"), "upstream-content");
			await git(tmpClone, ["add", "upstream.txt"]);
			await git(tmpClone, ["commit", "-m", "upstream commit"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			// Fetch upstream in canonical repo
			await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch", "upstream"]);

			await arb(env, ["create", "fork-ws", "repo-a"]);

			// Worktree should have the upstream commit (branched from upstream/main)
			expect(existsSync(join(env.projectDir, "fork-ws/repo-a/upstream.txt"))).toBe(true);
		}));

	test("fork: push targets the share remote (origin/fork)", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			await arb(env, ["create", "fork-push", "repo-a"]);

			// Make a commit
			await write(join(env.projectDir, "fork-push/repo-a/feature.txt"), "feature");
			await git(join(env.projectDir, "fork-push/repo-a"), ["add", "feature.txt"]);
			await git(join(env.projectDir, "fork-push/repo-a"), ["commit", "-m", "feature commit"]);

			const result = await arb(env, ["push", "--yes"], {
				cwd: join(env.projectDir, "fork-push"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Pushed");

			// Branch should exist on fork (origin), not on upstream
			const forkBranch = await git(join(env.testDir, "fork/repo-a.git"), ["branch"]);
			expect(forkBranch).toContain("fork-push");
		}));

	test("fork: rebase targets the upstream remote", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			await arb(env, ["create", "fork-rebase", "repo-a"]);

			// Add commits to upstream after workspace creation
			const tmpClone = join(env.testDir, "tmp-upstream-rebase");
			await git(env.testDir, ["clone", join(env.testDir, "upstream/repo-a.git"), tmpClone]);
			await write(join(tmpClone, "update.txt"), "upstream-update");
			await git(tmpClone, ["add", "update.txt"]);
			await git(tmpClone, ["commit", "-m", "upstream update"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			const result = await arb(env, ["rebase", "--yes"], {
				cwd: join(env.projectDir, "fork-rebase"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toMatch(/rebased fork-rebase onto upstream\/main|Rebased/);

			// Workspace should now have the upstream commit
			expect(existsSync(join(env.projectDir, "fork-rebase/repo-a/update.txt"))).toBe(true);
		}));

	test("fork: status shows upstream remote in BASE column", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			await arb(env, ["create", "fork-status", "repo-a"]);

			const result = await arb(env, ["status"], {
				cwd: join(env.projectDir, "fork-status"),
			});
			// BASE column should show upstream/main since upstream != share
			expect(result.output).toContain("upstream/main");
			// SHARE column should show origin/<branch>
			expect(result.output).toContain("origin/fork-status");
		}));

	test("fork: remove --delete-remote deletes from share remote", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			await arb(env, ["create", "fork-remove", "repo-a"]);

			// Push the branch first
			await write(join(env.projectDir, "fork-remove/repo-a/x.txt"), "x");
			await git(join(env.projectDir, "fork-remove/repo-a"), ["add", "x.txt"]);
			await git(join(env.projectDir, "fork-remove/repo-a"), ["commit", "-m", "x"]);
			await git(join(env.projectDir, "fork-remove/repo-a"), ["push", "-u", "origin", "fork-remove"]);

			// Verify branch exists on fork
			const forkBranch = await git(join(env.testDir, "fork/repo-a.git"), ["branch"]);
			expect(forkBranch).toContain("fork-remove");

			const result = await arb(env, ["delete", "fork-remove", "--yes", "--force", "--delete-remote"]);
			expect(result.exitCode).toBe(0);

			// Branch should be deleted from fork
			const forkBranchAfter = await git(join(env.testDir, "fork/repo-a.git"), ["branch"]);
			expect(forkBranchAfter).not.toContain("fork-remove");

			// Branch should NOT have been deleted from upstream
			const upstreamBranch = await git(join(env.testDir, "upstream/repo-a.git"), ["branch"]);
			expect(upstreamBranch).not.toContain("fork-remove");
		}));

	test("fork: mixed workspace — some repos forked, some single-origin", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			// repo-b keeps its single-origin setup from the main setup()

			await arb(env, ["create", "mixed-ws", "repo-a", "repo-b"]);

			const result = await arb(env, ["status"], {
				cwd: join(env.projectDir, "mixed-ws"),
			});
			// repo-a should show upstream/main, repo-b should show just main
			expect(result.output).toContain("upstream/main");
		}));

	test("fork: convention detection — upstream remote without pushDefault", () =>
		withEnv(async (env) => {
			const upstreamDir = join(env.testDir, "upstream/conv-test.git");
			const forkDir = join(env.testDir, "fork/conv-test.git");

			await mkdir(join(env.testDir, "upstream"), { recursive: true });
			await git(env.testDir, ["init", "--bare", upstreamDir, "-b", "main"]);
			const tmpClone = join(env.testDir, "tmp-conv");
			await git(env.testDir, ["clone", upstreamDir, tmpClone]);
			await git(tmpClone, ["commit", "--allow-empty", "-m", "init"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			await mkdir(join(env.testDir, "fork"), { recursive: true });
			await git(env.testDir, ["clone", "--bare", upstreamDir, forkDir]);
			await git(env.testDir, ["clone", forkDir, join(env.projectDir, ".arb/repos/conv-test")]);

			// Add upstream remote but do NOT set pushDefault — relies on convention
			await git(join(env.projectDir, ".arb/repos/conv-test"), ["remote", "add", "upstream", upstreamDir]);
			await git(join(env.projectDir, ".arb/repos/conv-test"), ["fetch", "upstream"]);
			await git(join(env.projectDir, ".arb/repos/conv-test"), ["remote", "set-head", "upstream", "--auto"]);

			await arb(env, ["create", "conv-ws", "conv-test"]);

			const result = await arb(env, ["status"], {
				cwd: join(env.projectDir, "conv-ws"),
			});
			expect(result.output).toContain("upstream/main");
		}));

	test("fork: non-standard remote names with pushDefault", () =>
		withEnv(async (env) => {
			const canonicalDir = join(env.testDir, "upstream/custom-names.git");
			const forkDir = join(env.testDir, "fork/custom-names.git");

			await mkdir(join(env.testDir, "upstream"), { recursive: true });
			await git(env.testDir, ["init", "--bare", canonicalDir, "-b", "main"]);
			const tmpClone = join(env.testDir, "tmp-custom");
			await git(env.testDir, ["clone", canonicalDir, tmpClone]);
			await git(tmpClone, ["commit", "--allow-empty", "-m", "init"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			await mkdir(join(env.testDir, "fork"), { recursive: true });
			await git(env.testDir, ["clone", "--bare", canonicalDir, forkDir]);
			await git(env.testDir, ["clone", forkDir, join(env.projectDir, ".arb/repos/custom-names")]);

			// Add canonical remote (not named "upstream") and set pushDefault
			await git(join(env.projectDir, ".arb/repos/custom-names"), ["remote", "add", "canonical", canonicalDir]);
			await git(join(env.projectDir, ".arb/repos/custom-names"), ["config", "remote.pushDefault", "origin"]);
			await git(join(env.projectDir, ".arb/repos/custom-names"), ["fetch", "canonical"]);
			await git(join(env.projectDir, ".arb/repos/custom-names"), ["remote", "set-head", "canonical", "--auto"]);

			await arb(env, ["create", "custom-ws", "custom-names"]);

			const result = await arb(env, ["status"], {
				cwd: join(env.projectDir, "custom-ws"),
			});
			// Should show canonical/main since canonical is the base remote
			expect(result.output).toContain("canonical/main");
		}));

	test("fork: single-origin repos show origin/ prefix in BASE column", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "single-origin-ws", "repo-a", "repo-b"]);

			const result = await arb(env, ["status"], {
				cwd: join(env.projectDir, "single-origin-ws"),
			});
			// BASE column should show origin/main (always includes remote prefix)
			expect(result.output).toContain("origin/main");
		}));

	test("fork: merge targets the upstream remote", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			await arb(env, ["create", "fork-merge", "repo-a"]);

			// Add commits to upstream after workspace creation
			const tmpClone = join(env.testDir, "tmp-upstream-merge");
			await git(env.testDir, ["clone", join(env.testDir, "upstream/repo-a.git"), tmpClone]);
			await write(join(tmpClone, "merge-update.txt"), "upstream-merge-update");
			await git(tmpClone, ["add", "merge-update.txt"]);
			await git(tmpClone, ["commit", "-m", "upstream merge update"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			const result = await arb(env, ["merge", "--yes"], {
				cwd: join(env.projectDir, "fork-merge"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toMatch(/merged upstream\/main into fork-merge|Merged/);

			// Workspace should now have the upstream commit
			expect(existsSync(join(env.projectDir, "fork-merge/repo-a/merge-update.txt"))).toBe(true);
		}));

	test("fork: ambiguous remotes error with 3 remotes and no pushDefault", () =>
		withEnv(async (env) => {
			const bareA = join(env.testDir, "upstream/ambig.git");
			const bareB = join(env.testDir, "fork/ambig.git");
			const bareC = join(env.testDir, "staging/ambig.git");

			await mkdir(join(env.testDir, "upstream"), { recursive: true });
			await git(env.testDir, ["init", "--bare", bareA, "-b", "main"]);
			const tmpClone = join(env.testDir, "tmp-ambig");
			await git(env.testDir, ["clone", bareA, tmpClone]);
			await git(tmpClone, ["commit", "--allow-empty", "-m", "init"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			await mkdir(join(env.testDir, "fork"), { recursive: true });
			await git(env.testDir, ["clone", "--bare", bareA, bareB]);
			await mkdir(join(env.testDir, "staging"), { recursive: true });
			await git(env.testDir, ["clone", "--bare", bareA, bareC]);

			await git(env.testDir, ["clone", bareB, join(env.projectDir, ".arb/repos/ambig")]);
			await git(join(env.projectDir, ".arb/repos/ambig"), ["remote", "add", "canonical", bareA]);
			await git(join(env.projectDir, ".arb/repos/ambig"), ["remote", "add", "staging", bareC]);

			// No pushDefault set, no "upstream" name — ambiguous, should fail with guidance
			const result = await arb(env, ["create", "ambig-ws", "ambig"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Cannot determine remote roles");
			expect(result.output).toContain("remote.pushDefault");
		}));

	test("fork: pull syncs from share remote", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			await arb(env, ["create", "fork-pull", "repo-a"]);

			// Push the branch to the fork (origin)
			await write(join(env.projectDir, "fork-pull/repo-a/init.txt"), "initial");
			await git(join(env.projectDir, "fork-pull/repo-a"), ["add", "init.txt"]);
			await git(join(env.projectDir, "fork-pull/repo-a"), ["commit", "-m", "initial"]);
			await git(join(env.projectDir, "fork-pull/repo-a"), ["push", "-u", "origin", "fork-pull"]);

			// Simulate someone else pushing to the fork
			const tmpClone = join(env.testDir, "tmp-fork-pull");
			await git(env.testDir, ["clone", join(env.testDir, "fork/repo-a.git"), tmpClone]);
			await git(tmpClone, ["checkout", "fork-pull"]);
			await write(join(tmpClone, "fork-change.txt"), "from-fork");
			await git(tmpClone, ["add", "fork-change.txt"]);
			await git(tmpClone, ["commit", "-m", "fork commit"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			const result = await arb(env, ["pull", "--yes"], {
				cwd: join(env.projectDir, "fork-pull"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Pulled");

			// Should have the fork commit
			expect(existsSync(join(env.projectDir, "fork-pull/repo-a/fork-change.txt"))).toBe(true);
		}));

	test("fork: arb attach in fork workspace sets up remotes correctly", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");

			// Set up a second fork repo
			const upstreamB = join(env.testDir, "upstream/repo-b-fork.git");
			const forkB = join(env.testDir, "fork/repo-b-fork.git");

			await git(env.testDir, ["init", "--bare", upstreamB, "-b", "main"]);
			const tmpClone = join(env.testDir, "tmp-repo-b-fork");
			await git(env.testDir, ["clone", upstreamB, tmpClone]);
			await write(join(tmpClone, "file.txt"), "upstream content");
			await git(tmpClone, ["add", "file.txt"]);
			await git(tmpClone, ["commit", "-m", "upstream init"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });
			await git(env.testDir, ["clone", "--bare", upstreamB, forkB]);

			// Clone fork as the canonical repo
			await rm(join(env.projectDir, ".arb/repos/repo-b-fork"), { recursive: true, force: true });
			await git(env.testDir, ["clone", forkB, join(env.projectDir, ".arb/repos/repo-b-fork")]);
			await git(join(env.projectDir, ".arb/repos/repo-b-fork"), ["remote", "add", "upstream", upstreamB]);
			await git(join(env.projectDir, ".arb/repos/repo-b-fork"), ["config", "remote.pushDefault", "origin"]);
			await git(join(env.projectDir, ".arb/repos/repo-b-fork"), ["fetch", "upstream"]);
			await git(join(env.projectDir, ".arb/repos/repo-b-fork"), ["remote", "set-head", "upstream", "--auto"]);

			// Create workspace with repo-a only
			await arb(env, ["create", "fork-add", "repo-a"]);

			// Add the second fork repo
			const result = await arb(env, ["attach", "repo-b-fork"], {
				cwd: join(env.projectDir, "fork-add"),
			});
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "fork-add/repo-b-fork"))).toBe(true);

			// Verify the branch was created from upstream (has upstream content)
			expect(existsSync(join(env.projectDir, "fork-add/repo-b-fork/file.txt"))).toBe(true);
		}));

	test("fork: repo clone --upstream fails gracefully with bad upstream URL", () =>
		withEnv(async (env) => {
			await mkdir(join(env.testDir, "fork"), { recursive: true });
			await git(env.testDir, ["init", "--bare", join(env.testDir, "fork/bad-upstream.git"), "-b", "main"]);
			const tmpClone = join(env.testDir, "tmp-bad-upstream");
			await git(env.testDir, ["clone", join(env.testDir, "fork/bad-upstream.git"), tmpClone]);
			await git(tmpClone, ["commit", "--allow-empty", "-m", "init"]);
			await git(tmpClone, ["push"]);
			await rm(tmpClone, { recursive: true });

			const result = await arb(env, [
				"repo",
				"clone",
				join(env.testDir, "fork/bad-upstream.git"),
				"bad-upstream",
				"--upstream",
				"/nonexistent/path/repo.git",
			]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Failed to fetch upstream");
		}));

	test("fork: arb repo list shows base remote for fork repos", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");
			// repo-b stays single-origin from setup()

			const result = await arb(env, ["repo", "list"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("SHARE");
			expect(result.output).toContain("BASE");
			// repo-a is a fork — BASE column should show "upstream"
			// repo-b is single-origin — BASE column should show "origin"
			const lines = result.output.split("\n");
			const repoALine = lines.find((l: string) => l.includes("repo-a"));
			const repoBLine = lines.find((l: string) => l.includes("repo-b"));
			expect(repoALine).toContain("upstream");
			expect(repoBLine).toContain("origin");
		}));

	test("fork: arb repo list --verbose shows both URLs for fork repos", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");

			const result = await arb(env, ["repo", "list", "--verbose"]);
			expect(result.exitCode).toBe(0);
			const lines = result.output.split("\n");
			const repoALine = lines.find((l: string) => l.includes("repo-a"));
			expect(repoALine).toContain("origin");
			expect(repoALine).toContain("upstream");
			expect(repoALine).toContain("fork/repo-a.git");
			expect(repoALine).toContain("upstream/repo-a.git");
		}));
});
