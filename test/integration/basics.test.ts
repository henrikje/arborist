import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, initBareRepo, withEnv, write } from "./helpers/env";

// ── version & help ───────────────────────────────────────────────

describe("version & help", () => {
	test("arb --version outputs version number", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["--version"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toMatch(/^Arborist (dev\.[0-9a-f]+|[0-9]+\.[0-9]+\.[0-9]+)/);
		}));

	test("arb version is treated as unknown command", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["version"]);
			expect(result.exitCode).not.toBe(0);
		}));

	test("arb -v outputs version number", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["-v"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toMatch(/^Arborist (dev\.[0-9a-f]+|[0-9]+\.[0-9]+\.[0-9]+)/);
		}));
});

// ── bare arb (shows help) ────────────────────────────────────────

describe("bare arb (shows help)", () => {
	test("bare arb shows help with usage and commands", () =>
		withEnv(async (env) => {
			const result = await arb(env, []);
			expect(result.output).toContain("Usage:");
			expect(result.output).toContain("Commands:");
		}));
});

// ── repo default (bare invocation defaults to list) ─────────────

describe("repo default", () => {
	test("arb repo defaults to arb repo list", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("repo-a");
			expect(result.output).toContain("repo-b");
		}));

	test("arb repo --quiet defaults to arb repo list --quiet", () =>
		withEnv(async (env) => {
			const explicitResult = await arb(env, ["repo", "list", "--quiet"]);
			expect(explicitResult.exitCode).toBe(0);
			const implicitResult = await arb(env, ["repo", "--quiet"]);
			expect(implicitResult.exitCode).toBe(0);
			expect(implicitResult.output).toBe(explicitResult.output);
		}));
});

// ── repo list ────────────────────────────────────────────────────

describe("repo list", () => {
	test("arb repo list lists cloned repo names", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "list"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("repo-a");
			expect(result.output).toContain("repo-b");
		}));

	test("arb repo list outputs header plus one repo per line", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "list"]);
			expect(result.exitCode).toBe(0);
			const lines = result.output.trimEnd().split("\n");
			expect(lines.length).toBe(3);
		}));

	test("arb repo list shows SHARE and BASE columns", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "list"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("SHARE");
			expect(result.output).toContain("BASE");
			expect(result.output).toContain("origin");
		}));

	test("arb repo list --verbose shows URLs", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "list", "--verbose"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("origin/repo-a.git");
			expect(result.output).toContain("origin/repo-b.git");
		}));

	test("arb repo list outside project fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "list"], { cwd: "/tmp" });
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Not inside a project");
		}));
});

// ── help ──────────────────────────────────────────────────────────

describe("help", () => {
	test("arb help shows full usage text", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Usage:");
			expect(result.output).toContain("repo");
		}));

	test("arb --help shows usage", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Usage:");
		}));

	test("arb -h shows usage", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["-h"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Usage:");
		}));

	test("arb help where shows filter syntax reference", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help", "where"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("WHERE FILTER SYNTAX");
			expect(result.output).toContain("dirty");
			expect(result.output).toContain("unpushed");
			expect(result.output).toContain("synced");
			expect(result.output).toContain("EXAMPLES");
		}));

	test("arb help status shows status command help", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help", "status"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("arb status");
			expect(result.output).toContain("arb help where");
		}));

	test("arb help remotes shows remote roles reference", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help", "remotes"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("REMOTE ROLES");
		}));

	test("arb help stacked shows stacked workspaces reference", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help", "stacked"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("STACKED WORKSPACES");
		}));

	test("arb help templates shows template reference", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help", "templates"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("TEMPLATE");
		}));

	test("arb help scripting shows scripting reference", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help", "scripting"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("SCRIPTING");
		}));

	test("arb help nonexistent shows error", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["help", "nonexistent"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Unknown command or topic");
		}));

	test("unknown command shows error", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["nonsense"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("unknown command");
		}));

	test("commands outside project fail with helpful message", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["list"], { cwd: "/tmp" });
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Not inside a project");
		}));
});

// ── init ─────────────────────────────────────────────────────────

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

// ── repo clone ───────────────────────────────────────────────────

describe("repo clone", () => {
	test("arb repo clone clones a repo into repos/", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "clone-test"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/clone-test/.git"))).toBe(true);
		}));

	test("arb repo clone derives name from URL", () =>
		withEnv(async (env) => {
			await initBareRepo(env.testDir, join(env.originDir, "derived-name.git"), "main");
			const result = await arb(env, ["repo", "clone", join(env.originDir, "derived-name.git")]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/derived-name/.git"))).toBe(true);
		}));

	test("arb repo clone detaches HEAD in canonical repo", () =>
		withEnv(async (env) => {
			const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "detach-test"]);
			expect(cloneResult.exitCode).toBe(0);
			const statusOutput = await git(join(env.projectDir, ".arb/repos/detach-test"), ["status"]);
			expect(statusOutput).toContain("HEAD detached");
		}));

	test("arb repo clone allows workspace on default branch", () =>
		withEnv(async (env) => {
			const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "main-test"]);
			expect(cloneResult.exitCode).toBe(0);
			const createResult = await arb(env, ["create", "main-ws", "--branch", "main", "main-test"]);
			expect(createResult.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "main-ws/main-test"))).toBe(true);
			const branch = (await git(join(env.projectDir, "main-ws/main-test"), ["symbolic-ref", "--short", "HEAD"])).trim();
			expect(branch).toBe("main");
		}));

	test("arb repo clone fails if repo already exists", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "repo-a"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("already cloned");
		}));

	test("arb repo clone fails with invalid path", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "clone", "/nonexistent/path/repo.git"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Clone failed");
		}));

	test("arb repo clone without args fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "clone"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("missing required argument");
		}));
});

// ── repo remove ──────────────────────────────────────────────────

describe("repo remove", () => {
	test("arb repo remove deletes a canonical repo", () =>
		withEnv(async (env) => {
			const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "remove-me"]);
			expect(cloneResult.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/remove-me/.git"))).toBe(true);
			const result = await arb(env, ["repo", "remove", "remove-me", "--yes"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/remove-me"))).toBe(false);
			expect(result.output).toContain("[remove-me] removed");
			expect(result.output).toContain("Removed 1 repo");
		}));

	test("arb repo remove cleans up template directory", () =>
		withEnv(async (env) => {
			const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "tpl-rm"]);
			expect(cloneResult.exitCode).toBe(0);
			const tplDir = join(env.projectDir, ".arb/templates/repos/tpl-rm");
			await mkdir(tplDir, { recursive: true });
			await write(join(tplDir, ".env"), "content");
			const result = await arb(env, ["repo", "remove", "tpl-rm", "--yes"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/tpl-rm"))).toBe(false);
		}));

	test("arb repo remove refuses when workspace uses repo", () =>
		withEnv(async (env) => {
			const createResult = await arb(env, ["create", "ws-using-repo", "-a"]);
			expect(createResult.exitCode).toBe(0);
			const result = await arb(env, ["repo", "remove", "repo-a", "--yes"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Cannot remove repo-a");
			expect(result.output).toContain("ws-using-repo");
			expect(existsSync(join(env.projectDir, ".arb/repos/repo-a/.git"))).toBe(true);
		}));

	test("arb repo remove fails for nonexistent repo", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "remove", "does-not-exist", "--yes"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("not cloned");
		}));

	test("arb repo remove removes multiple repos", () =>
		withEnv(async (env) => {
			const cloneA = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "multi-a"]);
			expect(cloneA.exitCode).toBe(0);
			const cloneB = await arb(env, ["repo", "clone", join(env.originDir, "repo-b.git"), "multi-b"]);
			expect(cloneB.exitCode).toBe(0);
			const result = await arb(env, ["repo", "remove", "multi-a", "multi-b", "--yes"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/multi-a"))).toBe(false);
			expect(existsSync(join(env.projectDir, ".arb/repos/multi-b"))).toBe(false);
			expect(result.output).toContain("Removed 2 repos");
		}));

	test("arb repo remove --all-repos removes all repos", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "remove", "--all-repos", "--yes"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Removed");
			const listResult = await arb(env, ["repo", "list"]);
			expect(listResult.output.trim()).toBe("");
		}));

	test("arb repo remove without args in non-TTY fails", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["repo", "remove"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("No repos specified");
		}));

	test("arb repo remove --dry-run shows plan but does not remove", () =>
		withEnv(async (env) => {
			const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "dry-rm"]);
			expect(cloneResult.exitCode).toBe(0);
			const result = await arb(env, ["repo", "remove", "dry-rm", "--dry-run"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/dry-rm"))).toBe(true);
			expect(result.output).toContain("dry-rm");
			expect(result.output).toContain("Dry run");
		}));

	test("arb repo remove -n is equivalent to --dry-run", () =>
		withEnv(async (env) => {
			const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "dry-rm-short"]);
			expect(cloneResult.exitCode).toBe(0);
			const result = await arb(env, ["repo", "remove", "dry-rm-short", "-n"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/repos/dry-rm-short"))).toBe(true);
			expect(result.output).toContain("Dry run");
		}));
});
