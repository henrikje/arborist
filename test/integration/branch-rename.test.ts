import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, withEnv } from "./helpers/env";

// ── basic rename ──────────────────────────────────────────────────

describe("basic rename", () => {
	test("arb branch rename renames branch in all repos and updates config", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Config updated
			const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
			expect(config).toContain("branch = feat/new-name");
			// branch_rename_from cleared on success
			expect(config).not.toContain("branch_rename_from");
			// Both repos on new branch
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			const branchB = (await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new-name");
			expect(branchB).toBe("feat/new-name");
		}));

	test("arb branch rename shows renamed repos in output", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Renamed");
		}));

	test("arb branch rename preserves base in config", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "--base", "main"]);
			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
			expect(config).toContain("base = main");
		}));
});

// ── no-op guard ───────────────────────────────────────────────────

describe("no-op guard", () => {
	test("arb branch rename same-name is a no-op", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "my-feature", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("nothing to do");
		}));
});

// ── validation ────────────────────────────────────────────────────

describe("validation", () => {
	test("arb branch rename rejects invalid branch name", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "invalid..name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Invalid branch name");
		}));

	test("arb branch rename outside workspace fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["branch", "rename", "feat/new-name"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Not inside a workspace");
		}));

	test("arb branch rename without new-name arg fails", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("required");
		}));
});

// ── dry-run ───────────────────────────────────────────────────────

describe("dry-run", () => {
	test("arb branch rename --dry-run shows plan without changes", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			const result = await arb(env, ["branch", "rename", "feat/new-name", "--dry-run", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Dry run");
			// Config not changed
			const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
			expect(config).toContain("branch = my-feature");
			// Branch not renamed
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("my-feature");
		}));
});

// ── already-on-new ────────────────────────────────────────────────

describe("already-on-new", () => {
	test("arb branch rename skips repos already on new branch", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Manually rename repo-a to the target branch
			await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "feat/new-name"]);
			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// repo-b should be renamed, repo-a was already there
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			const branchB = (await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new-name");
			expect(branchB).toBe("feat/new-name");
			expect(result.output).toContain("already renamed");
		}));
});

// ── skip-missing ─────────────────────────────────────────────────

describe("skip-missing", () => {
	test("arb branch rename skips repos where old branch is absent", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Manually switch repo-b to a different branch so the expected branch is gone
			await git(join(env.projectDir, "my-feature/repo-b"), ["checkout", "-b", "other-branch"]);
			await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "-D", "my-feature"]);
			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// repo-a renamed, repo-b skipped
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new-name");
			expect(result.output).toContain("skip");
		}));
});

// ── skip-in-progress ─────────────────────────────────────────────

describe("skip-in-progress", () => {
	test("arb branch rename skips repos with in-progress git operation", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Workspace repos are linked worktrees — .git is a file, not a directory.
			// Use git rev-parse --git-dir to find the actual git dir for this worktree.
			const wtA = join(env.projectDir, "my-feature/repo-a");
			let gitDir = (await git(wtA, ["rev-parse", "--git-dir"])).trim();
			if (!gitDir.startsWith("/")) {
				gitDir = join(wtA, gitDir);
			}
			await writeFile(join(gitDir, "MERGE_HEAD"), "");

			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// repo-a skipped, repo-b renamed
			const branchA = (await git(wtA, ["branch", "--show-current"])).trim();
			const branchB = (await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("my-feature");
			expect(branchB).toBe("feat/new-name");
			expect(result.output).toContain("in progress");
			const { rm } = await import("node:fs/promises");
			await rm(join(gitDir, "MERGE_HEAD"), { force: true });
		}));

	test("arb branch rename --include-in-progress renames repos with in-progress operations", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			const wtA = join(env.projectDir, "my-feature/repo-a");
			let gitDir = (await git(wtA, ["rev-parse", "--git-dir"])).trim();
			if (!gitDir.startsWith("/")) {
				gitDir = join(wtA, gitDir);
			}
			await writeFile(join(gitDir, "MERGE_HEAD"), "");

			const result = await arb(
				env,
				["branch", "rename", "feat/new-name", "--yes", "--no-fetch", "--include-in-progress"],
				{
					cwd: join(env.projectDir, "my-feature"),
				},
			);
			expect(result.exitCode).toBe(0);
			// Both repos renamed despite in-progress op in repo-a
			const branchA = (await git(wtA, ["branch", "--show-current"])).trim();
			const branchB = (await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new-name");
			expect(branchB).toBe("feat/new-name");
			const { rm } = await import("node:fs/promises");
			await rm(join(gitDir, "MERGE_HEAD"), { force: true });
		}));
});

// ── migration state ───────────────────────────────────────────────

describe("migration state", () => {
	test("arb branch rename --continue resumes partial rename", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Simulate partial failure: config updated but repo-b not yet renamed
			await writeFile(
				join(env.projectDir, "my-feature/.arbws/config"),
				"branch = feat/new-name\nbranch_rename_from = my-feature\n",
			);
			// repo-a already renamed, repo-b still on old branch
			await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "feat/new-name"]);

			const result = await arb(env, ["branch", "rename", "--continue", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Both repos now on new branch
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			const branchB = (await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new-name");
			expect(branchB).toBe("feat/new-name");
			// Migration state cleared
			const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
			expect(config).not.toContain("branch_rename_from");
		}));

	test("arb branch rename --abort rolls back partial rename", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Simulate partial rename: repo-a done, repo-b still on old
			await writeFile(
				join(env.projectDir, "my-feature/.arbws/config"),
				"branch = feat/new-name\nbranch_rename_from = my-feature\n",
			);
			await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "feat/new-name"]);

			const result = await arb(env, ["branch", "rename", "--abort", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// repo-a rolled back, repo-b unchanged (already on old)
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			const branchB = (await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("my-feature");
			expect(branchB).toBe("my-feature");
			// Config restored
			const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
			expect(config).toContain("branch = my-feature");
			expect(config).not.toContain("branch_rename_from");
		}));

	test("arb branch rename --abort without migration state fails", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "--abort", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("No rename in progress");
		}));

	test("arb branch rename --continue without migration state fails", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "--continue", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("No rename in progress");
		}));

	test("arb branch rename blocks conflicting rename when migration is in progress", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Simulate migration in progress toward feat/new-name
			await writeFile(
				join(env.projectDir, "my-feature/.arbws/config"),
				"branch = feat/new-name\nbranch_rename_from = my-feature\n",
			);
			// Try to start a rename to a DIFFERENT target
			const result = await arb(env, ["branch", "rename", "feat/other-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("already in progress");
		}));

	test("arb branch rename with same target as in-progress treats as resume", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Simulate partial: repo-a done, repo-b still on old
			await writeFile(
				join(env.projectDir, "my-feature/.arbws/config"),
				"branch = feat/new-name\nbranch_rename_from = my-feature\n",
			);
			await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "feat/new-name"]);

			// Same target as in-progress = resume
			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			const branchB = (await git(join(env.projectDir, "my-feature/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchB).toBe("feat/new-name");
		}));
});

// ── --abort dry-run ───────────────────────────────────────────────

describe("--abort dry-run", () => {
	test("arb branch rename --abort --dry-run shows plan without changes", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await writeFile(
				join(env.projectDir, "my-feature/.arbws/config"),
				"branch = feat/new-name\nbranch_rename_from = my-feature\n",
			);
			await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "feat/new-name"]);

			const result = await arb(env, ["branch", "rename", "--abort", "--dry-run", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Dry run");
			// Nothing changed
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new-name");
			const config = await readFile(join(env.projectDir, "my-feature/.arbws/config"), "utf8");
			expect(config).toContain("branch_rename_from");
		}));
});

// ── remote ────────────────────────────────────────────────────────

describe("remote", () => {
	test("arb branch rename --delete-remote deletes old remote branch", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Push the old branch to remote first
			await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
			// Verify it exists
			await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "my-feature"]);

			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--delete-remote"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Old remote branch deleted
			const verifyProc = Bun.spawn(
				["git", "-C", join(env.originDir, "repo-a.git"), "rev-parse", "--verify", "my-feature"],
				{ stdout: "pipe", stderr: "pipe" },
			);
			await verifyProc.exited;
			expect(await verifyProc.exited).not.toBe(0);
			// Local branch renamed
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new-name");
		}));

	test("arb branch rename hints about arb push when old remote branch exists", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

			const result = await arb(env, ["branch", "rename", "feat/new-name", "--yes", "--keep-workspace-name"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("arb push");
			// Old remote branch NOT deleted
			await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "my-feature"]);
		}));
});

// ── workspace rename ─────────────────────────────────────────────

describe("workspace rename", () => {
	test("arb branch rename auto-renames workspace when names match", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			const result = await arb(env, ["branch", "rename", "short-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Workspace directory renamed
			expect(existsSync(join(env.projectDir, "short-name"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
			// Config at new path
			const config = await readFile(join(env.projectDir, "short-name/.arbws/config"), "utf8");
			expect(config).toContain("branch = short-name");
			// Repos on new branch
			const branchA = (await git(join(env.projectDir, "short-name/repo-a"), ["branch", "--show-current"])).trim();
			const branchB = (await git(join(env.projectDir, "short-name/repo-b"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("short-name");
			expect(branchB).toBe("short-name");
			// Stdout contains new path
			expect(result.output).toContain(join(env.projectDir, "short-name"));
		}));

	test("arb branch rename warns when branch has slash (invalid workspace name)", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "feat/new", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Workspace NOT renamed (slash in branch name)
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
			expect(result.output).toContain("not a valid workspace name");
			expect(result.output).toContain("--workspace-name");
		}));

	test("arb branch rename --keep-workspace-name prevents workspace rename", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(
				env,
				["branch", "rename", "short-name", "--yes", "--no-fetch", "--keep-workspace-name"],
				{
					cwd: join(env.projectDir, "my-feature"),
				},
			);
			expect(result.exitCode).toBe(0);
			// Workspace NOT renamed
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
			expect(existsSync(join(env.projectDir, "short-name"))).toBe(false);
			// Branch still renamed
			const branchA = (await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("short-name");
		}));

	test("arb branch rename --workspace-name renames workspace explicitly", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(
				env,
				["branch", "rename", "feat/new", "--yes", "--no-fetch", "--workspace-name", "feat-new"],
				{
					cwd: join(env.projectDir, "my-feature"),
				},
			);
			expect(result.exitCode).toBe(0);
			// Workspace renamed to explicit name
			expect(existsSync(join(env.projectDir, "feat-new"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
			// Branch renamed
			const branchA = (await git(join(env.projectDir, "feat-new/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("feat/new");
			// Stdout contains new path
			expect(result.output).toContain(join(env.projectDir, "feat-new"));
		}));

	test("arb branch rename --workspace-name rejects invalid name", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(
				env,
				["branch", "rename", "short-name", "--yes", "--no-fetch", "--workspace-name", "bad/name"],
				{
					cwd: join(env.projectDir, "my-feature"),
				},
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("must not contain '/'");
			// Nothing changed
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
		}));

	test("arb branch rename --workspace-name rejects existing directory", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await arb(env, ["create", "other-ws", "repo-b"]);
			const result = await arb(
				env,
				["branch", "rename", "short-name", "--yes", "--no-fetch", "--workspace-name", "other-ws"],
				{
					cwd: join(env.projectDir, "my-feature"),
				},
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("already exists");
		}));

	test("arb branch rename --workspace-name conflicts with --keep-workspace-name", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(
				env,
				[
					"branch",
					"rename",
					"short-name",
					"--yes",
					"--no-fetch",
					"--workspace-name",
					"new-ws",
					"--keep-workspace-name",
				],
				{
					cwd: join(env.projectDir, "my-feature"),
				},
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Cannot combine");
		}));

	test("arb branch rename does not rename workspace when names differ", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-ws", "-b", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "short-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-ws"),
			});
			expect(result.exitCode).toBe(0);
			// Workspace stays because ws name (my-ws) != old branch (my-feature)
			expect(existsSync(join(env.projectDir, "my-ws"))).toBe(true);
			expect(existsSync(join(env.projectDir, "short-name"))).toBe(false);
			// Branch still renamed
			const branchA = (await git(join(env.projectDir, "my-ws/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("short-name");
		}));

	test("arb branch rename warns when target workspace directory exists", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, "short-name"), { recursive: true });
			const result = await arb(env, ["branch", "rename", "short-name", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Workspace NOT renamed (target exists)
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
			expect(result.output).toContain("already exists");
			expect(result.output).toContain("--workspace-name");
		}));

	test("arb branch rename --dry-run does not rename workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "short-name", "--dry-run", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Dry run");
			// Workspace NOT renamed
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
			expect(existsSync(join(env.projectDir, "short-name"))).toBe(false);
		}));

	test("arb branch rename shows workspace rename in plan", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "short-name", "--dry-run", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Renaming workspace");
		}));

	test("arb branch rename standalone workspace rename via same branch + --workspace-name", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["branch", "rename", "my-feature", "--workspace-name", "new-ws"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Workspace renamed
			expect(existsSync(join(env.projectDir, "new-ws"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
			// Branch unchanged
			const branchA = (await git(join(env.projectDir, "new-ws/repo-a"), ["branch", "--show-current"])).trim();
			expect(branchA).toBe("my-feature");
			// Stdout contains new path
			expect(result.output).toContain(join(env.projectDir, "new-ws"));
		}));
});

// ── tracking cleanup ─────────────────────────────────────────────

describe("tracking cleanup", () => {
	test("arb branch rename clears tracking so push sees new branch", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Push the old branch to set up tracking
			await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
			// Verify tracking exists
			const merge = (
				await git(join(env.projectDir, "my-feature/repo-a"), ["config", "branch.my-feature.merge"])
			).trim();
			expect(merge).toBe("refs/heads/my-feature");

			const result = await arb(env, ["branch", "rename", "new-name", "--yes", "--keep-workspace-name"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);

			// Tracking cleared
			const verifyMerge = Bun.spawn(
				["git", "-C", join(env.projectDir, "my-feature/repo-a"), "config", "branch.new-name.merge"],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(await verifyMerge.exited).not.toBe(0);
			const verifyRemote = Bun.spawn(
				["git", "-C", join(env.projectDir, "my-feature/repo-a"), "config", "branch.new-name.remote"],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(await verifyRemote.exited).not.toBe(0);
		}));

	test("arb push after branch rename pushes new branch name", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Make a commit so there's something to push
			await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "--allow-empty", "-m", "test commit"]);
			// Push old branch
			await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

			await arb(env, ["branch", "rename", "new-name", "--yes", "--keep-workspace-name"], {
				cwd: join(env.projectDir, "my-feature"),
			});

			const result = await arb(env, ["push", "--yes"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// New remote branch exists
			await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "new-name"]);
			// Tracking now points to new branch
			const trackingMerge = (
				await git(join(env.projectDir, "my-feature/repo-a"), ["config", "branch.new-name.merge"])
			).trim();
			expect(trackingMerge).toBe("refs/heads/new-name");
		}));

	test("arb branch rename clears stale tracking for already-renamed repos", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Push repo-a to set up tracking
			await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

			// Simulate partial: repo-a manually renamed (tracking still stale)
			await git(join(env.projectDir, "my-feature/repo-a"), ["branch", "-m", "my-feature", "new-name"]);
			await writeFile(
				join(env.projectDir, "my-feature/.arbws/config"),
				"branch = new-name\nbranch_rename_from = my-feature\n",
			);

			const result = await arb(env, ["branch", "rename", "--continue", "--yes", "--no-fetch"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);

			// Even repo-a (already renamed) should have tracking cleared
			const verifyMerge = Bun.spawn(
				["git", "-C", join(env.projectDir, "my-feature/repo-a"), "config", "branch.new-name.merge"],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(await verifyMerge.exited).not.toBe(0);
		}));

	test("arb branch rename --delete-remote plus push creates clean remote state", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "--allow-empty", "-m", "test"]);
			await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

			await arb(env, ["branch", "rename", "new-name", "--yes", "--delete-remote", "--keep-workspace-name"], {
				cwd: join(env.projectDir, "my-feature"),
			});

			const result = await arb(env, ["push", "--yes"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Old remote gone
			const verifyOld = Bun.spawn(
				["git", "-C", join(env.originDir, "repo-a.git"), "rev-parse", "--verify", "my-feature"],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(await verifyOld.exited).not.toBe(0);
			// New remote exists
			await git(join(env.originDir, "repo-a.git"), ["rev-parse", "--verify", "new-name"]);
		}));

	test("arb branch rename plan shows remote status in REMOTE column", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

			const result = await arb(env, ["branch", "rename", "new-name", "--dry-run", "--keep-workspace-name"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("leave");
			expect(result.output).toContain("in place");
		}));
});
