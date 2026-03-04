import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv } from "./helpers/env";

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

	test("shared worktree entry is detected and warned about", () =>
		withEnv(async (env) => {
			// Create two workspaces with repo-a
			await arb(env, ["create", "ws-alpha", "repo-a"]);
			await arb(env, ["create", "ws-beta", "repo-a"]);

			// Corrupt ws-alpha to point to ws-beta's worktree entry
			const wsBetaGitContent = readFileSync(join(env.projectDir, "ws-beta/repo-a/.git"), "utf-8").trim();
			writeFileSync(join(env.projectDir, "ws-alpha/repo-a/.git"), wsBetaGitContent);

			// Run any command that calls requireWorkspace() — status is a good candidate
			const result = await arb(env, ["-C", join(env.projectDir, "ws-alpha"), "status", "-N"]);

			// Should warn about the shared entry
			expect(result.output).toContain("shares worktree entry");
			expect(result.output).toContain("ws-beta");
		}));

	test("valid worktree directory is correctly skipped without stale warning", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-ok", "repo-a"]);

			// Attach repo-a again — should skip with "already exists", NOT "stale"
			const result = await arb(env, ["attach", "repo-a"], { cwd: join(env.projectDir, "ws-ok") });
			expect(result.output).toContain("already exists");
			expect(result.output).not.toContain("stale");
		}));
});
