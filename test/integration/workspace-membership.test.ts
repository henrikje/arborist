import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, pushThenDeleteRemote, withEnv, write } from "./helpers/env";

// ── create ───────────────────────────────────────────────────────

describe("create", () => {
	test("arb create creates workspace with .arbws/config", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "--all-repos"]);
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature/.arbws"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature/.arbws/config"))).toBe(true);
		}));

	test(".arbws/config contains correct branch", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "--all-repos"]);
			const content = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
			expect(content).toContain("branch = my-feature");
		}));

	test("arb create with repos creates workspace repos", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
		}));

	test("arb create --all-repos creates workspace repos for all repos", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "all-ws", "--all-repos"]);
			expect(existsSync(join(env.projectDir, "all-ws/repo-a"))).toBe(true);
			expect(existsSync(join(env.projectDir, "all-ws/repo-b"))).toBe(true);
		}));

	test("arb create -a creates workspace repos for all repos", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "all-ws", "-a"]);
			expect(existsSync(join(env.projectDir, "all-ws/repo-a"))).toBe(true);
			expect(existsSync(join(env.projectDir, "all-ws/repo-b"))).toBe(true);
		}));

	test("arb create --branch stores custom branch in config", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "payments", "--branch", "feat/payments", "repo-a"]);
			const content = await readFile(join(env.projectDir, "payments/.arbws/config"), "utf8");
			expect(content).toContain("branch = feat/payments");
		}));

	test("arb create -b stores custom branch in config", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "payments", "-b", "feat/payments", "repo-a"]);
			const content = await readFile(join(env.projectDir, "payments/.arbws/config"), "utf8");
			expect(content).toContain("branch = feat/payments");
		}));

	test("arb create attaches existing branch", () =>
		withEnv(async (env) => {
			const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
			await git(canonicalRepoA, ["checkout", "-b", "reuse-me"]);
			await write(join(canonicalRepoA, "marker.txt"), "branch-content");
			await git(canonicalRepoA, ["add", "marker.txt"]);
			await git(canonicalRepoA, ["commit", "-m", "marker"]);
			await git(canonicalRepoA, ["checkout", "-"]);

			await arb(env, ["create", "reuse-ws", "--branch", "reuse-me", "repo-a"]);
			expect(existsSync(join(env.projectDir, "reuse-ws/repo-a/marker.txt"))).toBe(true);
			const branch = (await git(join(env.projectDir, "reuse-ws/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
			expect(branch).toBe("reuse-me");
		}));

	test("arb create checks out existing remote branch", () =>
		withEnv(async (env) => {
			const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
			await git(canonicalRepoA, ["checkout", "-b", "remote-only"]);
			await write(join(canonicalRepoA, "remote-marker.txt"), "remote-content");
			await git(canonicalRepoA, ["add", "remote-marker.txt"]);
			await git(canonicalRepoA, ["commit", "-m", "remote marker"]);
			await git(canonicalRepoA, ["push", "-u", "origin", "remote-only"]);
			await git(canonicalRepoA, ["checkout", "--detach", "HEAD"]);
			await git(canonicalRepoA, ["branch", "-D", "remote-only"]);

			await arb(env, ["create", "remote-ws", "--branch", "remote-only", "repo-a"]);

			expect(existsSync(join(env.projectDir, "remote-ws/repo-a/remote-marker.txt"))).toBe(true);
			const branch = (await git(join(env.projectDir, "remote-ws/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
			expect(branch).toBe("remote-only");
			const trackingRemote = (
				await git(join(env.projectDir, "remote-ws/repo-a"), ["config", "branch.remote-only.remote"])
			).trim();
			expect(trackingRemote).toBe("origin");
		}));

	test("arb create remote branch sets tracking even with autoSetupMerge off", () =>
		withEnv(async (env) => {
			const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
			await git(canonicalRepoA, ["config", "branch.autoSetupMerge", "false"]);
			await git(canonicalRepoA, ["checkout", "-b", "no-auto-track"]);
			await write(join(canonicalRepoA, "no-auto.txt"), "no-auto-content");
			await git(canonicalRepoA, ["add", "no-auto.txt"]);
			await git(canonicalRepoA, ["commit", "-m", "no-auto marker"]);
			await git(canonicalRepoA, ["push", "-u", "origin", "no-auto-track"]);
			await git(canonicalRepoA, ["checkout", "--detach", "HEAD"]);
			await git(canonicalRepoA, ["branch", "-D", "no-auto-track"]);

			await arb(env, ["create", "no-auto-ws", "--branch", "no-auto-track", "repo-a"]);

			const trackingRemote = (
				await git(join(env.projectDir, "no-auto-ws/repo-a"), ["config", "branch.no-auto-track.remote"])
			).trim();
			expect(trackingRemote).toBe("origin");
		}));

	test("arb create outputs workspace path on stdout", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "foo", "repo-a"]);
			expect(result.stdout.trim()).toBe(join(env.projectDir, "foo"));
		}));

	test("arb create path output is clean when stdout is captured (shell wrapper pattern)", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "capture-test", "repo-a"]);
			expect(result.stdout.trim()).toBe(join(env.projectDir, "capture-test"));
		}));

	test("arb create shows workspace path", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "path-test", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain(join(env.projectDir, "path-test"));
		}));

	test("arb create with duplicate workspace name fails", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["create", "my-feature", "repo-b"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("already exists");
		}));

	test("arb create with no repos fails in non-TTY", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "no-repos-ws"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Usage: arb create");
		}));

	test("arb create without name fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Usage: arb create");
		}));

	test("arb create --branch without name derives workspace name from branch tail", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "--branch", "claude/improve-arb-create-ux-Ipru1", "--all-repos"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain(
				"! Workspace name: improve-arb-create-ux-Ipru1 (derived from claude/improve-arb-create-ux-Ipru1)",
			);
			const wsDir = join(env.projectDir, "improve-arb-create-ux-Ipru1");
			expect(existsSync(wsDir)).toBe(true);
			expect(existsSync(join(wsDir, "repo-a"))).toBe(true);
			expect(existsSync(join(wsDir, "repo-b"))).toBe(true);
			const config = await readFile(join(wsDir, ".arbws/config"), "utf8");
			expect(config).toContain("branch = claude/improve-arb-create-ux-Ipru1");
		}));

	test("arb create --branch without name fails when derived workspace already exists", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "existing-tail", "repo-a"]);
			const result = await arb(env, ["create", "--branch", "claude/existing-tail", "--all-repos"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Derived workspace name 'existing-tail'");
			expect(result.output).toContain("already exists");
		}));

	test("arb create --branch without value fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "foo", "--branch"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("argument missing");
		}));

	test("arb create with invalid branch name fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "bad-ws", "--branch", "bad branch name with spaces", "repo-a"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Invalid branch name");
		}));

	test("arb create rejects name with slash", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "bad/name"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("must not contain '/'");
		}));

	test("arb create with slash name suggests --branch usage when input looks like branch", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "claude/improve-arb-create-ux-Ipru1"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("may have pasted a branch name");
			expect(result.output).toContain("arb create --branch claude/improve-arb-create-ux-Ipru1");
		}));

	test("arb create rejects name with path traversal", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "foo..bar"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("must not contain '..'");
		}));

	test("arb create rejects name with whitespace", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "bad name"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("must not contain whitespace");
		}));

	test("arb create with nonexistent repo fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "ws-bad", "badrepo"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Unknown repos: badrepo");
			expect(result.output).toContain("Not found in .arb/repos/");
		}));

	test("arb create with name and repos derives branch without interactive prompts", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "FeatureFoo", "repo-a", "repo-b"]);
			expect(result.exitCode).toBe(0);
			const config = await readFile(join(env.projectDir, "FeatureFoo/.arbws/config"), "utf8");
			expect(config).toContain("branch = FeatureFoo");
			expect(existsSync(join(env.projectDir, "FeatureFoo/repo-a"))).toBe(true);
			expect(existsSync(join(env.projectDir, "FeatureFoo/repo-b"))).toBe(true);
		}));

	test("arb create with name, repos, and --branch skips branch derivation", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "my-ws", "-b", "custom/branch", "repo-a"]);
			expect(result.exitCode).toBe(0);
			const config = await readFile(join(env.projectDir, "my-ws/.arbws/config"), "utf8");
			expect(config).toContain("branch = custom/branch");
		}));

	test("arb create with --base stores base without interactive prompt", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "stacked-ws", "-b", "feat/ui", "--base", "feat/core", "repo-a"]);
			expect(result.exitCode).toBe(0);
			const config = await readFile(join(env.projectDir, "stacked-ws/.arbws/config"), "utf8");
			expect(config).toContain("branch = feat/ui");
			expect(config).toContain("base = feat/core");
		}));

	test("arb create without --base omits base from config in non-TTY", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "no-base-ws", "repo-a"]);
			expect(result.exitCode).toBe(0);
			const config = await readFile(join(env.projectDir, "no-base-ws/.arbws/config"), "utf8");
			expect(config).toContain("branch = no-base-ws");
			expect(config).not.toContain("base =");
		}));

	test("arb create checks out existing remote branch with name on CLI", () =>
		withEnv(async (env) => {
			const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
			await git(canonicalRepoA, ["checkout", "-b", "shared-feat"]);
			await write(join(canonicalRepoA, "shared.txt"), "shared");
			await git(canonicalRepoA, ["add", "shared.txt"]);
			await git(canonicalRepoA, ["commit", "-m", "shared commit"]);
			await git(canonicalRepoA, ["push", "-u", "origin", "shared-feat"]);
			await git(canonicalRepoA, ["checkout", "--detach", "HEAD"]);
			await git(canonicalRepoA, ["branch", "-D", "shared-feat"]);

			const result = await arb(env, ["create", "collab-ws", "-b", "shared-feat", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "collab-ws/repo-a/shared.txt"))).toBe(true);
			const branch = (await git(join(env.projectDir, "collab-ws/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
			expect(branch).toBe("shared-feat");
		}));
});

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
			await writeFile(join(env.projectDir, "my-feature/.arbws/config"), "branch = my-feature");
			const result = await arb(env, ["attach", "repo-a", "repo-b"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
		}));
});

// ── detach ───────────────────────────────────────────────────────

describe("detach", () => {
	test("arb detach removes a repo from workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await arb(env, ["detach", "repo-b"], { cwd: join(env.projectDir, "my-feature") });
			expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
		}));

	test("arb detach skips repo with uncommitted changes without --force", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
			const result = await arb(env, ["detach", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
			expect(result.output).toContain("uncommitted changes");
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
		}));

	test("arb detach --force removes repo even with uncommitted changes", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
			await arb(env, ["detach", "--force", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
		}));

	test("arb detach -f removes repo even with uncommitted changes", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
			await arb(env, ["detach", "-f", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
		}));

	test("arb detach --delete-branch also deletes local branch", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await arb(env, ["detach", "--delete-branch", "repo-b"], { cwd: join(env.projectDir, "my-feature") });
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
			const result = await arb(env, ["detach", "repo-b"], { cwd: join(env.projectDir, "my-feature") });
			expect(result.output).toContain("not in this workspace");
		}));

	test("arb detach rejects unknown repos", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["detach", "nonexistent"], { cwd: join(env.projectDir, "my-feature") });
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
			const result = await arb(env, ["detach", "-a"], { cwd: join(env.projectDir, "my-feature") });
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
			expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
		}));

	test("arb detach --all-repos detaches all repos from workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			const result = await arb(env, ["detach", "--all-repos"], { cwd: join(env.projectDir, "my-feature") });
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(false);
			expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(false);
		}));

	test("arb detach -a on empty workspace errors", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, "empty-ws/.arbws"), { recursive: true });
			await writeFile(join(env.projectDir, "empty-ws/.arbws/config"), "branch = empty");
			const result = await arb(env, ["detach", "-a"], { cwd: join(env.projectDir, "empty-ws") });
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("No repos in this workspace");
		}));

	test("arb detach without workspace context fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["detach", "repo-a"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Not inside a workspace");
		}));
});

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
			await rm(join(env.projectDir, "ws-broken/.arbws/config"));

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
