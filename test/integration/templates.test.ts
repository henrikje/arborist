import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, setupForkRepo, withEnv, write } from "./helpers/env";

// ── templates ─────────────────────────────────────────────────────

describe("templates", () => {
	test("arb init creates .arb/.gitignore with repos/ entry", () =>
		withEnv(async (env) => {
			const dir = join(env.testDir, "init-gitignore");
			await mkdir(dir, { recursive: true });
			const result = await arb(env, ["init"], { cwd: dir });
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(dir, ".arb/.gitignore"))).toBe(true);
			const content = await readFile(join(dir, ".arb/.gitignore"), "utf8");
			expect(content).toContain("repos/");
		}));

	test("arb create applies workspace templates", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/setup.txt"), "ws-file");

			await arb(env, ["create", "tpl-ws-test", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-ws-test/setup.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-ws-test/setup.txt"), "utf8");
			expect(content.trimEnd()).toBe("ws-file");
		}));

	test("arb create applies repo templates", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "DB=localhost");

			await arb(env, ["create", "tpl-repo-test", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-repo-test/repo-a/.env"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-repo-test/repo-a/.env"), "utf8");
			expect(content.trimEnd()).toBe("DB=localhost");
		}));

	test("arb create applies nested template directory structure", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace/.claude"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.claude/settings.local.json"), '{"key":"val"}');

			await arb(env, ["create", "tpl-nested-test", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-nested-test/.claude/settings.local.json"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-nested-test/.claude/settings.local.json"), "utf8");
			expect(content.trimEnd()).toBe('{"key":"val"}');
		}));

	test("template files are not overwritten if they already exist", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "template-content");

			await arb(env, ["create", "tpl-nooverwrite", "repo-a"]);
			// Overwrite the seeded file
			await writeFile(join(env.projectDir, "tpl-nooverwrite/repo-a/.env"), "custom-content");

			// Add repo-b to trigger template application again (repo-a already has the file)
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-b"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-b/.env"), "b-env");
			await arb(env, ["attach", "repo-b"], { cwd: join(env.projectDir, "tpl-nooverwrite") });

			// repo-a's file should still have the custom content
			const content = await readFile(join(env.projectDir, "tpl-nooverwrite/repo-a/.env"), "utf8");
			expect(content.trimEnd()).toBe("custom-content");
		}));

	test("arb create works without templates directory", () =>
		withEnv(async (env) => {
			// No templates dir exists — should succeed silently
			const result = await arb(env, ["create", "tpl-none-test", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "tpl-none-test/repo-a"))).toBe(true);
		}));

	test("arb attach applies repo templates for newly added repos", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-b"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-b/.env"), "ADDED=true");

			await arb(env, ["create", "tpl-add-test", "repo-a"]);
			await arb(env, ["attach", "repo-b"], { cwd: join(env.projectDir, "tpl-add-test") });

			expect(existsSync(join(env.projectDir, "tpl-add-test/repo-b/.env"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-add-test/repo-b/.env"), "utf8");
			expect(content.trimEnd()).toBe("ADDED=true");
		}));

	test("template for a repo not in the workspace is silently ignored", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/nonexistent-repo"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/nonexistent-repo/.env"), "ignored");

			const result = await arb(env, ["create", "tpl-ignore-test", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "tpl-ignore-test/nonexistent-repo/.env"))).toBe(false);
		}));

	test("workspace templates applied when creating workspace with zero repos", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/config.txt"), "empty-ws");

			await arb(env, ["create", "tpl-empty-ws"]);
			expect(existsSync(join(env.projectDir, "tpl-empty-ws/config.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-empty-ws/config.txt"), "utf8");
			expect(content.trimEnd()).toBe("empty-ws");
		}));

	test("arb create reports seeded template count", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/ws.txt"), "a");
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "b");

			const result = await arb(env, ["create", "tpl-count-test", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Seeded 2 template files");
		}));

	test("arb delete --all-safe --force produces per-workspace output", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-one", "repo-a"]);
			await arb(env, ["create", "ws-two", "repo-a"]);
			await git(join(env.projectDir, "ws-one/repo-a"), ["push", "-u", "origin", "ws-one"]);
			await git(join(env.projectDir, "ws-two/repo-a"), ["push", "-u", "origin", "ws-two"]);

			const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			// Should have columnar table with workspace names
			expect(result.output).toContain("ws-one");
			expect(result.output).toContain("ws-two");
			expect(result.output).toContain("no issues");
			// Should have compact inline results during execution
			expect(result.output).toContain("[ws-one] deleted");
			expect(result.output).toContain("[ws-two] deleted");
			expect(result.output).toContain("Deleted 2 workspaces");
		}));

	test("arb delete multiple names --force shows unified plan then compact execution", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-x", "repo-a"]);
			await arb(env, ["create", "ws-y", "repo-b"]);

			const result = await arb(env, ["delete", "ws-x", "ws-y", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			// Unified plan: columnar table with workspace names
			expect(result.output).toContain("ws-x");
			expect(result.output).toContain("ws-y");
			// Compact execution lines
			expect(result.output).toContain("[ws-x] deleted");
			expect(result.output).toContain("[ws-y] deleted");
			expect(result.output).toContain("Deleted 2 workspaces");
		}));

	test("arb delete single name --force keeps detailed output", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-solo", "repo-a"]);

			const result = await arb(env, ["delete", "ws-solo", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("[ws-solo] deleted");
			expect(result.output).toContain("Deleted 1 workspace");
		}));
});

// ── remove: template drift detection ─────────────────────────────

describe("remove: template drift detection", () => {
	test("arb delete shows template drift info for modified repo template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "DB=localhost");

			await arb(env, ["create", "tpl-drift", "repo-a"]);
			// Modify the template-seeded file
			await writeFile(join(env.projectDir, "tpl-drift/repo-a/.env"), "DB=production");

			const result = await arb(env, ["delete", "tpl-drift", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Template files modified");
			expect(result.output).toContain("[repo-a] .env");
		}));

	test("arb delete shows template drift info for modified workspace template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "WS=original");

			await arb(env, ["create", "tpl-drift-ws", "repo-a"]);
			await writeFile(join(env.projectDir, "tpl-drift-ws/.env"), "WS=modified");

			const result = await arb(env, ["delete", "tpl-drift-ws", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Template files modified");
			expect(result.output).toContain(".env");
		}));

	test("arb delete shows no template drift when files are unchanged", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "DB=localhost");

			await arb(env, ["create", "tpl-nodrift", "repo-a"]);
			// Don't modify the file

			const result = await arb(env, ["delete", "tpl-nodrift", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).not.toContain("Template files modified");
		}));

	test("arb delete multi-workspace shows unified plan with template drift", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "DB=localhost");

			await arb(env, ["create", "tpl-multi-a", "repo-a"]);
			await arb(env, ["create", "tpl-multi-b", "repo-a"]);
			await writeFile(join(env.projectDir, "tpl-multi-a/repo-a/.env"), "DB=custom");

			const result = await arb(env, ["delete", "tpl-multi-a", "tpl-multi-b", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			// Should show columnar table with workspace names
			expect(result.output).toContain("tpl-multi-a");
			expect(result.output).toContain("tpl-multi-b");
			// Only tpl-multi-a has drift
			expect(result.output).toContain("Template files modified");
			expect(result.output).toContain("Deleted 2 workspaces");
		}));

	test("arb delete multi-workspace refuses all when one is at-risk", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "at-risk-a", "repo-a"]);
			await arb(env, ["create", "at-risk-b", "repo-a"]);

			// Make at-risk-a dirty
			await writeFile(join(env.projectDir, "at-risk-a/repo-a/dirty.txt"), "uncommitted");

			const result = await arb(env, ["delete", "at-risk-a", "at-risk-b"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Refusing to delete");
			expect(result.output).toContain("at-risk-a");
			// Both workspaces should still exist
			expect(existsSync(join(env.projectDir, "at-risk-a"))).toBe(true);
			expect(existsSync(join(env.projectDir, "at-risk-b"))).toBe(true);
		}));

	test("arb delete --all-safe shows template drift in status table", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "WS=original");

			await arb(env, ["create", "tpl-allok", "repo-a"]);
			await git(join(env.projectDir, "tpl-allok/repo-a"), ["push", "-u", "origin", "tpl-allok"]);
			// Modify workspace-level template file (outside git repos, doesn't affect dirty status)
			await writeFile(join(env.projectDir, "tpl-allok/.env"), "WS=modified");

			const result = await arb(env, ["delete", "--all-safe", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Template files modified");
			expect(existsSync(join(env.projectDir, "tpl-allok"))).toBe(false);
		}));

	test("arb delete --force succeeds when cwd is inside the workspace being removed", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "doomed", "repo-a", "repo-b"]);

			const result = await arb(env, ["delete", "doomed", "--yes", "--force"], {
				cwd: join(env.projectDir, "doomed"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Deleted 1 workspace");
			expect(existsSync(join(env.projectDir, "doomed"))).toBe(false);
		}));

	test("arb delete --yes skips confirmation for clean workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-yes", "repo-a"]);
			await git(join(env.projectDir, "ws-yes/repo-a"), ["push", "-u", "origin", "ws-yes"]);

			const result = await arb(env, ["delete", "ws-yes", "--yes"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "ws-yes"))).toBe(false);
			expect(result.output).toContain("Deleted 1 workspace");
			expect(result.output).toContain("Skipping confirmation");
		}));

	test("arb delete -y skips confirmation for clean workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-yshort", "repo-a"]);
			await git(join(env.projectDir, "ws-yshort/repo-a"), ["push", "-u", "origin", "ws-yshort"]);

			const result = await arb(env, ["delete", "ws-yshort", "-y"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "ws-yshort"))).toBe(false);
		}));

	test("arb delete --yes still refuses at-risk workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-atrisk", "repo-a"]);
			await writeFile(join(env.projectDir, "ws-atrisk/repo-a/dirty.txt"), "uncommitted");

			const result = await arb(env, ["delete", "ws-atrisk", "--yes"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Refusing to delete");
			expect(existsSync(join(env.projectDir, "ws-atrisk"))).toBe(true);
		}));

	test("arb delete --force without --yes still requires confirmation", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-fy", "repo-a"]);
			await writeFile(join(env.projectDir, "ws-fy/repo-a/dirty.txt"), "uncommitted");

			const result = await arb(env, ["delete", "ws-fy", "--force"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("Not a terminal");
			expect(existsSync(join(env.projectDir, "ws-fy"))).toBe(true);
		}));

	test("arb delete -r shows remote deletion notice in plan", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-dnotice", "repo-a"]);
			await git(join(env.projectDir, "ws-dnotice/repo-a"), ["push", "-u", "origin", "ws-dnotice"]);

			const result = await arb(env, ["delete", "ws-dnotice", "-y", "-r"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Remote branches will also be deleted");
			expect(existsSync(join(env.projectDir, "ws-dnotice"))).toBe(false);
			// Remote branch should be gone
			let showRefFailed = false;
			try {
				await git(join(env.projectDir, ".arb/repos/repo-a"), [
					"show-ref",
					"--verify",
					"refs/remotes/origin/ws-dnotice",
				]);
			} catch {
				showRefFailed = true;
			}
			expect(showRefFailed).toBe(true);
		}));

	test("arb delete --all-safe --yes skips confirmation", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-allok-y", "repo-a"]);
			await git(join(env.projectDir, "ws-allok-y/repo-a"), ["push", "-u", "origin", "ws-allok-y"]);

			const result = await arb(env, ["delete", "--all-safe", "--yes"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "ws-allok-y"))).toBe(false);
			expect(result.output).toContain("Skipping confirmation");
		}));

	test("arb delete --all-safe -r shows remote deletion notice", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-allok-d", "repo-a"]);
			await git(join(env.projectDir, "ws-allok-d/repo-a"), ["push", "-u", "origin", "ws-allok-d"]);

			const result = await arb(env, ["delete", "--all-safe", "--yes", "-r"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Remote branches will also be deleted");
			expect(existsSync(join(env.projectDir, "ws-allok-d"))).toBe(false);
		}));
});

// ── template ─────────────────────────────────────────────────────

describe("template", () => {
	test("arb template defaults to arb template list", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["template"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("No templates defined");
		}));

	test("arb template list shows no templates when none defined", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["template", "list"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("No templates defined");
		}));

	test("arb template add captures a workspace file as template", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "SECRET=abc");
			const result = await arb(env, ["template", "add", ".env", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(existsSync(join(env.projectDir, ".arb/templates/workspace/.env"))).toBe(true);
		}));

	test("arb template add captures a repo file as template", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/repo-a/.env"), "DB=localhost");
			const result = await arb(env, ["template", "add", ".env"], {
				cwd: join(env.projectDir, "my-feature/repo-a"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(result.output).toContain("repo: repo-a");
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-a/.env"))).toBe(true);
		}));

	test("arb template add with --repo overrides scope detection", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/repo-a/.env"), "DB=localhost");
			const result = await arb(env, ["template", "add", "repo-a/.env", "--repo", "repo-a"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-a/.env"))).toBe(true);
		}));

	test("arb template add refuses overwrite without --force", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "OLD");
			await writeFile(join(env.projectDir, "my-feature/.env"), "NEW");
			const result = await arb(env, ["template", "add", ".env", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("already exists");
		}));

	test("arb template add --force overwrites existing template", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "OLD");
			await writeFile(join(env.projectDir, "my-feature/.env"), "NEW");
			const result = await arb(env, ["template", "add", ".env", "--workspace", "--force"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Updated template");
			const content = await readFile(join(env.projectDir, ".arb/templates/workspace/.env"), "utf8");
			expect(content.trimEnd()).toBe("NEW");
		}));

	test("arb template add succeeds silently when content is identical", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "SAME\n");
			await writeFile(join(env.projectDir, "my-feature/.env"), "SAME\n");
			const result = await arb(env, ["template", "add", ".env", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("already up to date");
		}));

	test("arb template list shows workspace and repo templates", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "WS");
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "REPO");
			const result = await arb(env, ["template", "list"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("SCOPE");
			expect(result.output).toContain("PATH");
			expect(result.output).toContain("workspace");
			expect(result.output).toContain("repo-a");
			expect(result.output).toContain(".env");
		}));

	test("arb template list shows modified annotation inside workspace", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "ORIGINAL");
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "MODIFIED");
			const result = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("modified");
		}));

	test("arb template diff shows no changes when templates match", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "SAME\n");
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "SAME\n");
			const result = await arb(env, ["template", "diff"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("No changes");
		}));

	test("arb template diff exits 1 when drift is found", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "ORIGINAL");
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "MODIFIED");
			const result = await arb(env, ["template", "diff"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("ORIGINAL");
			expect(result.output).toContain("MODIFIED");
		}));

	test("arb template diff filters by file path", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "A");
			await write(join(env.projectDir, ".arb/templates/workspace/.config"), "B");
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "A-modified");
			await writeFile(join(env.projectDir, "my-feature/.config"), "B-modified");
			const result = await arb(env, ["template", "diff", ".env"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain(".env");
			expect(result.output).not.toContain(".config");
		}));

	test("arb template diff filters by --repo", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-b"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "A");
			await write(join(env.projectDir, ".arb/templates/repos/repo-b/.env"), "B");
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await writeFile(join(env.projectDir, "my-feature/repo-a/.env"), "A-modified");
			await writeFile(join(env.projectDir, "my-feature/repo-b/.env"), "B-modified");
			const result = await arb(env, ["template", "diff", "--repo", "repo-a"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("repo-a");
			expect(result.output).not.toContain("repo-b");
		}));

	test("arb list --where at-risk filters workspaces", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-dirty", "repo-a"]);
			await arb(env, ["create", "ws-clean", "repo-a"]);
			await writeFile(join(env.projectDir, "ws-dirty/repo-a/dirty.txt"), "dirty");
			await writeFile(join(env.projectDir, "ws-clean/repo-a/f.txt"), "change");
			await git(join(env.projectDir, "ws-clean/repo-a"), ["add", "f.txt"]);
			await git(join(env.projectDir, "ws-clean/repo-a"), ["commit", "-m", "commit"]);
			await git(join(env.projectDir, "ws-clean/repo-a"), ["push", "-u", "origin", "ws-clean"]);
			const result = await arb(env, ["list", "--where", "at-risk"]);
			expect(result.output).toContain("ws-dirty");
			expect(result.output).not.toContain("ws-clean");
		}));

	test("arb delete --all-safe --where gone narrows to safe-and-gone", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "ws-gone", "repo-a"]);
			await arb(env, ["create", "ws-safe", "repo-a"]);
			// Make ws-gone have a gone remote (push then delete remote branch)
			await writeFile(join(env.projectDir, "ws-gone/repo-a/f.txt"), "change");
			await git(join(env.projectDir, "ws-gone/repo-a"), ["add", "f.txt"]);
			await git(join(env.projectDir, "ws-gone/repo-a"), ["commit", "-m", "commit"]);
			await git(join(env.projectDir, "ws-gone/repo-a"), ["push", "-u", "origin", "ws-gone"]);
			await git(join(env.originDir, "repo-a.git"), ["branch", "-D", "ws-gone"]);
			await git(join(env.projectDir, "ws-gone/repo-a"), ["fetch", "--prune"]);
			// Push ws-safe (safe but not gone)
			await writeFile(join(env.projectDir, "ws-safe/repo-a/f.txt"), "change");
			await git(join(env.projectDir, "ws-safe/repo-a"), ["add", "f.txt"]);
			await git(join(env.projectDir, "ws-safe/repo-a"), ["commit", "-m", "commit"]);
			await git(join(env.projectDir, "ws-safe/repo-a"), ["push", "-u", "origin", "ws-safe"]);

			const result = await arb(env, ["delete", "--all-safe", "--where", "gone", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "ws-gone"))).toBe(false);
			expect(existsSync(join(env.projectDir, "ws-safe"))).toBe(true);
		}));

	test("arb template apply seeds missing files", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Set up templates AFTER create so they haven't been seeded yet
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "SEEDED");
			const result = await arb(env, ["template", "apply"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Seeded");
			const content = await readFile(join(env.projectDir, "my-feature/.env"), "utf8");
			expect(content.trimEnd()).toBe("SEEDED");
		}));

	test("arb template apply skips existing files", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "TEMPLATE");
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "CUSTOM");
			const result = await arb(env, ["template", "apply"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("already present");
			const content = await readFile(join(env.projectDir, "my-feature/.env"), "utf8");
			expect(content.trimEnd()).toBe("CUSTOM");
		}));

	test("arb template apply --force resets drifted files", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "TEMPLATE");
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "DRIFTED");
			const result = await arb(env, ["template", "apply", "--force"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("reset");
			const content = await readFile(join(env.projectDir, "my-feature/.env"), "utf8");
			expect(content.trimEnd()).toBe("TEMPLATE");
		}));

	test("arb template apply --repo limits to specific repo", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Set up templates AFTER create so they haven't been seeded yet
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "WS");
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "REPO");
			const result = await arb(env, ["template", "apply", "--repo", "repo-a"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Repo template seeded
			expect(existsSync(join(env.projectDir, "my-feature/repo-a/.env"))).toBe(true);
			// Workspace template NOT seeded (--repo limits scope)
			expect(existsSync(join(env.projectDir, "my-feature/.env"))).toBe(false);
		}));

	test("arb template apply --workspace limits to workspace scope", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Set up templates AFTER create so they haven't been seeded yet
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "WS");
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "REPO");
			const result = await arb(env, ["template", "apply", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Workspace template seeded
			expect(existsSync(join(env.projectDir, "my-feature/.env"))).toBe(true);
			// Repo template NOT seeded (--workspace limits scope)
			expect(existsSync(join(env.projectDir, "my-feature/repo-a/.env"))).toBe(false);
		}));

	test("arb template apply filters by file path", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Set up templates AFTER create so they haven't been seeded yet
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "A");
			await write(join(env.projectDir, ".arb/templates/workspace/.config"), "B");
			const result = await arb(env, ["template", "apply", ".env"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, "my-feature/.env"))).toBe(true);
			expect(existsSync(join(env.projectDir, "my-feature/.config"))).toBe(false);
		}));

	test("arb template --help shows subcommands", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["template", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("add");
			expect(result.output).toContain("list");
			expect(result.output).toContain("diff");
			expect(result.output).toContain("apply");
		}));

	test("arb template add with multiple --repo flags", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await writeFile(join(env.projectDir, "my-feature/repo-a/.env"), "DB=localhost");
			const result = await arb(env, ["template", "add", "repo-a/.env", "--repo", "repo-a", "--repo", "repo-b"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-a/.env"))).toBe(true);
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-b/.env"))).toBe(true);
		}));

	test("arb template add with multiple --repo continues past conflict", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			// Pre-create a conflicting template for repo-a only
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "OLD");
			await writeFile(join(env.projectDir, "my-feature/repo-a/.env"), "NEW");
			const result = await arb(env, ["template", "add", "repo-a/.env", "--repo", "repo-a", "--repo", "repo-b"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			// Should fail (conflict on repo-a) but still add repo-b
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("already exists");
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-b/.env"))).toBe(true);
			const content = await readFile(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "utf8");
			expect(content.trimEnd()).toBe("OLD");
		}));

	test("arb template add directory adds all files recursively with --workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, "my-feature/.idea"), { recursive: true });
			await writeFile(join(env.projectDir, "my-feature/.idea/workspace.xml"), "file-a");
			await writeFile(join(env.projectDir, "my-feature/.idea/modules.xml"), "file-b");
			const result = await arb(env, ["template", "add", ".idea", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(existsSync(join(env.projectDir, ".arb/templates/workspace/.idea/workspace.xml"))).toBe(true);
			expect(existsSync(join(env.projectDir, ".arb/templates/workspace/.idea/modules.xml"))).toBe(true);
		}));

	test("arb template add directory adds all files for repo scope", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, "my-feature/repo-a/.idea"), { recursive: true });
			await writeFile(join(env.projectDir, "my-feature/repo-a/.idea/misc.xml"), "repo-file");
			const result = await arb(env, ["template", "add", ".idea"], {
				cwd: join(env.projectDir, "my-feature/repo-a"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-a/.idea/misc.xml"))).toBe(true);
		}));

	test("arb template add directory handles nested subdirectories", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, "my-feature/.claude/settings"), { recursive: true });
			await writeFile(join(env.projectDir, "my-feature/.claude/config.json"), "top");
			await writeFile(join(env.projectDir, "my-feature/.claude/settings/local.json"), "nested");
			const result = await arb(env, ["template", "add", ".claude", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/templates/workspace/.claude/config.json"))).toBe(true);
			expect(existsSync(join(env.projectDir, ".arb/templates/workspace/.claude/settings/local.json"))).toBe(true);
			const content = await readFile(
				join(env.projectDir, ".arb/templates/workspace/.claude/settings/local.json"),
				"utf8",
			);
			expect(content.trimEnd()).toBe("nested");
		}));

	test("arb template add directory with --force overwrites existing templates", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, ".arb/templates/workspace/.idea"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.idea/workspace.xml"), "OLD");
			await mkdir(join(env.projectDir, "my-feature/.idea"), { recursive: true });
			await writeFile(join(env.projectDir, "my-feature/.idea/workspace.xml"), "NEW");
			const result = await arb(env, ["template", "add", ".idea", "--workspace", "--force"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Updated template");
			const content = await readFile(join(env.projectDir, ".arb/templates/workspace/.idea/workspace.xml"), "utf8");
			expect(content.trimEnd()).toBe("NEW");
		}));

	test("arb template add directory refuses overwrite without --force", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, ".arb/templates/workspace/.idea"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.idea/workspace.xml"), "OLD");
			await mkdir(join(env.projectDir, "my-feature/.idea"), { recursive: true });
			await writeFile(join(env.projectDir, "my-feature/.idea/workspace.xml"), "NEW");
			const result = await arb(env, ["template", "add", ".idea", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("already exists");
		}));

	test("arb template add directory with --repo adds all files for explicit repo", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, "my-feature/repo-a/.idea"), { recursive: true });
			await writeFile(join(env.projectDir, "my-feature/repo-a/.idea/misc.xml"), "explicit");
			const result = await arb(env, ["template", "add", "repo-a/.idea", "--repo", "repo-a"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-a/.idea/misc.xml"))).toBe(true);
			const content = await readFile(join(env.projectDir, ".arb/templates/repos/repo-a/.idea/misc.xml"), "utf8");
			expect(content.trimEnd()).toBe("explicit");
		}));

	test("arb template add directory with auto-detected workspace scope", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await mkdir(join(env.projectDir, "my-feature/.config"), { recursive: true });
			await writeFile(join(env.projectDir, "my-feature/.config/settings.json"), "auto");
			const result = await arb(env, ["template", "add", ".config", "--workspace"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(existsSync(join(env.projectDir, ".arb/templates/workspace/.config/settings.json"))).toBe(true);
			// Now verify it applies to a new workspace
			await arb(env, ["create", "second-ws", "repo-a"]);
			expect(existsSync(join(env.projectDir, "second-ws/.config/settings.json"))).toBe(true);
			const content = await readFile(join(env.projectDir, "second-ws/.config/settings.json"), "utf8");
			expect(content.trimEnd()).toBe("auto");
		}));

	test("arb template add infers workspace scope from path outside repo", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "SECRET=abc");
			const result = await arb(env, ["template", "add", "../.env"], {
				cwd: join(env.projectDir, "my-feature/repo-a"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(result.output).not.toContain("repo:");
			expect(existsSync(join(env.projectDir, ".arb/templates/workspace/.env"))).toBe(true);
		}));

	test("arb template add infers repo scope from path inside another repo", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
			await writeFile(join(env.projectDir, "my-feature/repo-b/.env"), "DB=localhost");
			const result = await arb(env, ["template", "add", "../repo-b/.env"], {
				cwd: join(env.projectDir, "my-feature/repo-a"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Added template");
			expect(result.output).toContain("repo: repo-b");
			expect(existsSync(join(env.projectDir, ".arb/templates/repos/repo-b/.env"))).toBe(true);
		}));

	test("arb template add errors when path is outside workspace", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "my-feature", "repo-a"]);
			const tmpfile = join(env.testDir, "outside-file.tmp");
			await writeFile(tmpfile, "outside");
			const result = await arb(env, ["template", "add", tmpfile], {
				cwd: join(env.projectDir, "my-feature/repo-a"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("outside the workspace");
		}));

	test("arb template list aligns modified annotations", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "SHORT");
			await write(join(env.projectDir, ".arb/templates/workspace/some-longer-filename.txt"), "LONG");
			await arb(env, ["create", "my-feature", "repo-a"]);
			await writeFile(join(env.projectDir, "my-feature/.env"), "CHANGED");
			await writeFile(join(env.projectDir, "my-feature/some-longer-filename.txt"), "CHANGED");
			const result = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			// Both should show modified and the output should contain padding
			expect(result.output).toMatch(/\.env.*modified/);
			expect(result.output).toMatch(/some-longer-filename\.txt.*modified/);
			// STATUS header should appear when inside workspace
			expect(result.output).toContain("STATUS");
		}));
});

// ── .arbtemplate LiquidJS rendering ───────────────────────────────

describe(".arbtemplate LiquidJS rendering", () => {
	test("arb create applies .arbtemplate with workspace variables", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/config.json.arbtemplate"),
				"{{ workspace.name }}:{{ workspace.path }}:{{ root.path }}",
			);

			await arb(env, ["create", "tpl-sub-ws", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-sub-ws/config.json"))).toBe(true);
			expect(existsSync(join(env.projectDir, "tpl-sub-ws/config.json.arbtemplate"))).toBe(false);
			const content = await readFile(join(env.projectDir, "tpl-sub-ws/config.json"), "utf8");
			expect(content).toBe(`tpl-sub-ws:${join(env.projectDir, "tpl-sub-ws")}:${env.projectDir}`);
		}));

	test("arb create applies .arbtemplate with repo variables", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/repos/repo-a/settings.json.arbtemplate"),
				"{{ repo.name }}:{{ repo.path }}",
			);

			await arb(env, ["create", "tpl-sub-repo", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-sub-repo/repo-a/settings.json"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-sub-repo/repo-a/settings.json"), "utf8");
			expect(content).toBe(`repo-a:${join(env.projectDir, "tpl-sub-repo/repo-a")}`);
		}));

	test("arb template apply seeds .arbtemplate with rendering", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "tpl-apply-sub", "repo-a"]);
			// Set up templates AFTER create so they haven't been seeded yet
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/marker.txt.arbtemplate"), "{{ workspace.name }}");
			const result = await arb(env, ["template", "apply"], {
				cwd: join(env.projectDir, "tpl-apply-sub"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Seeded");
			const content = await readFile(join(env.projectDir, "tpl-apply-sub/marker.txt"), "utf8");
			expect(content.trimEnd()).toBe("tpl-apply-sub");
		}));

	test("arb template apply --force resets .arbtemplate files to rendered content", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/marker.txt.arbtemplate"), "{{ workspace.name }}");
			await arb(env, ["create", "tpl-force-sub", "repo-a"]);
			await writeFile(join(env.projectDir, "tpl-force-sub/marker.txt"), "DRIFTED");
			const result = await arb(env, ["template", "apply", "--force"], {
				cwd: join(env.projectDir, "tpl-force-sub"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("reset");
			const content = await readFile(join(env.projectDir, "tpl-force-sub/marker.txt"), "utf8");
			expect(content.trimEnd()).toBe("tpl-force-sub");
		}));

	test("arb template diff compares rendered content for .arbtemplate", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/marker.txt.arbtemplate"), "{{ workspace.name }}");
			await arb(env, ["create", "tpl-diff-sub", "repo-a"]);
			// Content matches rendered value — no drift expected
			const result1 = await arb(env, ["template", "diff"], {
				cwd: join(env.projectDir, "tpl-diff-sub"),
			});
			expect(result1.exitCode).toBe(0);
			expect(result1.output).toContain("No changes");

			// Now modify to create drift
			await writeFile(join(env.projectDir, "tpl-diff-sub/marker.txt"), "wrong");
			const result2 = await arb(env, ["template", "diff"], {
				cwd: join(env.projectDir, "tpl-diff-sub"),
			});
			expect(result2.exitCode).toBe(1);
		}));

	test("arb template list shows template annotation for .arbtemplate", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/config.json.arbtemplate"), "{{ workspace.name }}");
			await write(join(env.projectDir, ".arb/templates/workspace/plain.txt"), "static");
			// Outside workspace — STATUS column still shows (template, conflict, misplaced are intrinsic)
			const result = await arb(env, ["template", "list"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("config.json");
			expect(result.output).toContain("plain.txt");
			expect(result.output).toContain("STATUS");
			expect(result.output).toContain("template");
		}));

	test("mix of .arbtemplate and regular files in same template directory", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/dynamic.txt.arbtemplate"), "{{ workspace.name }}");
			await write(join(env.projectDir, ".arb/templates/workspace/static.txt"), "static content");

			await arb(env, ["create", "tpl-mix-test", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-mix-test/dynamic.txt"))).toBe(true);
			expect(existsSync(join(env.projectDir, "tpl-mix-test/static.txt"))).toBe(true);
			const dynamicContent = await readFile(join(env.projectDir, "tpl-mix-test/dynamic.txt"), "utf8");
			expect(dynamicContent.trimEnd()).toBe("tpl-mix-test");
			const staticContent = await readFile(join(env.projectDir, "tpl-mix-test/static.txt"), "utf8");
			expect(staticContent.trimEnd()).toBe("static content");
		}));
});

// ── template conflict detection ──────────────────────────────────

describe("template conflict detection", () => {
	test("arb create warns when both plain and .arbtemplate exist", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/config.json"), "plain");
			await writeFile(join(env.projectDir, ".arb/templates/workspace/config.json.arbtemplate"), "{{ workspace.name }}");

			const result = await arb(env, ["create", "tpl-conflict-test", "repo-a"]);
			expect(result.exitCode).toBe(0);
			// Grouped format with remediation instructions (matching template list/apply)
			expect(result.output).toContain("Conflicting templates");
			expect(result.output).toContain(".arb/templates/workspace/config.json");
			expect(result.output).toContain("remove either");
			// The file should still be created (first one wins)
			expect(existsSync(join(env.projectDir, "tpl-conflict-test/config.json"))).toBe(true);
		}));

	test("arb template list shows conflict annotation when both variants exist", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/config.json"), "plain");
			await writeFile(join(env.projectDir, ".arb/templates/workspace/config.json.arbtemplate"), "{{ workspace.name }}");

			// Inside a workspace so STATUS column appears
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("config.json");
			expect(result.output).toContain("conflict");
			// Conflict detail section
			expect(result.output).toContain("Conflicting templates");
			expect(result.output).toContain(".arb/templates/workspace/config.json");
		}));
});

// ── deleted detection ──────────────────────────────────────────────

describe("deleted detection", () => {
	test("arb template list shows deleted annotation when workspace file removed", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "ORIGINAL");
			await arb(env, ["create", "my-feature", "repo-a"]);
			// Delete the workspace copy of the seeded file
			await rm(join(env.projectDir, "my-feature/.env"), { force: true });
			const result = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("deleted");
			expect(result.output).toContain(".env");
			expect(result.output).toContain("STATUS");
		}));

	test("arb template list shows template annotation inside workspace", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/config.json.arbtemplate"), "{{ workspace.name }}");
			await write(join(env.projectDir, ".arb/templates/workspace/plain.txt"), "static");
			await arb(env, ["create", "my-feature", "repo-a"]);
			const result = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "my-feature"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toMatch(/config\.json.*template/);
			expect(result.output).toContain("plain.txt");
			expect(result.output).toContain("STATUS");
		}));

	test("arb delete shows template drift info for deleted workspace file", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "ORIGINAL");

			await arb(env, ["create", "tpl-drift-del", "repo-a"]);
			await rm(join(env.projectDir, "tpl-drift-del/.env"), { force: true });

			const result = await arb(env, ["delete", "tpl-drift-del", "--yes", "--force"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Template files deleted");
			expect(result.output).toContain(".env");
		}));
});

// ── repo-aware templates (iteration) ──────────────────────────────

describe("repo-aware templates (iteration)", () => {
	test("arb create renders template with repo list", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-iter", "repo-a", "repo-b"]);
			expect(existsSync(join(env.projectDir, "tpl-iter/repos.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-iter/repos.txt"), "utf8");
			expect(content).toContain("repo-a");
			expect(content).toContain("repo-b");
		}));

	test("arb attach regenerates repo-aware workspace template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-attach-regen", "repo-a"]);
			// Should have been seeded with just repo-a
			const before = await readFile(join(env.projectDir, "tpl-attach-regen/repos.txt"), "utf8");
			expect(before).toContain("repo-a");
			expect(before).not.toContain("repo-b");

			const result = await arb(env, ["attach", "repo-b"], {
				cwd: join(env.projectDir, "tpl-attach-regen"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Regenerated");

			const after = await readFile(join(env.projectDir, "tpl-attach-regen/repos.txt"), "utf8");
			expect(after).toContain("repo-a");
			expect(after).toContain("repo-b");
		}));

	test("arb detach regenerates repo-aware workspace template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-detach-regen", "repo-a", "repo-b"]);
			const before = await readFile(join(env.projectDir, "tpl-detach-regen/repos.txt"), "utf8");
			expect(before).toContain("repo-a");
			expect(before).toContain("repo-b");

			const result = await arb(env, ["detach", "repo-b"], {
				cwd: join(env.projectDir, "tpl-detach-regen"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Regenerated");

			const after = await readFile(join(env.projectDir, "tpl-detach-regen/repos.txt"), "utf8");
			expect(after).toContain("repo-a");
			expect(after).not.toContain("repo-b");
		}));

	test("arb attach skips overwrite when user has edited repo-aware template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-user-edit", "repo-a"]);
			// User edits the file
			await writeFile(join(env.projectDir, "tpl-user-edit/repos.txt"), "my custom repos list");

			await arb(env, ["attach", "repo-b"], {
				cwd: join(env.projectDir, "tpl-user-edit"),
			});

			// File should NOT be overwritten
			const content = await readFile(join(env.projectDir, "tpl-user-edit/repos.txt"), "utf8");
			expect(content.trimEnd()).toBe("my custom repos list");
		}));

	test("arb template apply --force overwrites user-edited repo-aware template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-force-regen", "repo-a", "repo-b"]);
			await writeFile(join(env.projectDir, "tpl-force-regen/repos.txt"), "user edited");

			const result = await arb(env, ["template", "apply", "--force"], {
				cwd: join(env.projectDir, "tpl-force-regen"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("reset");
			const content = await readFile(join(env.projectDir, "tpl-force-regen/repos.txt"), "utf8");
			expect(content).toContain("repo-a");
			expect(content).toContain("repo-b");
		}));

	test("forloop.last works for trailing comma in JSON template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/modules.json.arbtemplate"),
				'{%- for wt in workspace.repos %}\n"{{ wt.name }}"{% unless forloop.last %},{% endunless %}\n{%- endfor %}\n',
			);

			await arb(env, ["create", "tpl-comma", "repo-a", "repo-b"]);
			const content = await readFile(join(env.projectDir, "tpl-comma/modules.json"), "utf8");
			// Should have comma between items but not after last
			expect(content).toContain('"repo-a",');
			expect(content).toContain('"repo-b"');
			// Last item should NOT have trailing comma
			expect(content).not.toContain('"repo-b",');
		}));

	test("workspace.repos available in repo-scoped template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/repos/repo-a/siblings.txt.arbtemplate"),
				"siblings: {% for wt in workspace.repos %}{{ wt.name }} {% endfor %}",
			);

			await arb(env, ["create", "tpl-siblings", "repo-a", "repo-b"]);
			expect(existsSync(join(env.projectDir, "tpl-siblings/repo-a/siblings.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-siblings/repo-a/siblings.txt"), "utf8");
			expect(content).toContain("repo-a");
			expect(content).toContain("repo-b");
		}));

	test("sequential attach/detach maintains correct template state", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-seq", "repo-a"]);

			// Attach repo-b
			await arb(env, ["attach", "repo-b"], { cwd: join(env.projectDir, "tpl-seq") });
			const afterAttach = await readFile(join(env.projectDir, "tpl-seq/repos.txt"), "utf8");
			expect(afterAttach).toContain("repo-a");
			expect(afterAttach).toContain("repo-b");

			// Detach repo-a
			await arb(env, ["detach", "repo-a"], { cwd: join(env.projectDir, "tpl-seq") });
			const afterDetach = await readFile(join(env.projectDir, "tpl-seq/repos.txt"), "utf8");
			expect(afterDetach).not.toContain("repo-a");
			expect(afterDetach).toContain("repo-b");
		}));

	test("arb template diff detects drift with repo-aware template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-diff-iter", "repo-a", "repo-b"]);
			// No drift initially
			const result1 = await arb(env, ["template", "diff"], {
				cwd: join(env.projectDir, "tpl-diff-iter"),
			});
			expect(result1.exitCode).toBe(0);
			expect(result1.output).toContain("No changes");

			// Modify the file
			await writeFile(join(env.projectDir, "tpl-diff-iter/repos.txt"), "wrong");
			const result2 = await arb(env, ["template", "diff"], {
				cwd: join(env.projectDir, "tpl-diff-iter"),
			});
			expect(result2.exitCode).toBe(1);
		}));

	test("arb template list shows drift for repo-aware template", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/repos.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-list-iter", "repo-a"]);
			await writeFile(join(env.projectDir, "tpl-list-iter/repos.txt"), "wrong");
			const result = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "tpl-list-iter"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("modified");
		}));
});

// ── remote URL in templates ───────────────────────────────────────

describe("remote URL in templates", () => {
	test("arb create renders template with baseRemote.url", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/remotes.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.name }}={{ wt.baseRemote.url }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-remote", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-remote/remotes.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-remote/remotes.txt"), "utf8");
			// repo-a has origin remote pointing to the bare repo
			expect(content).toContain("repo-a=");
			expect(content).toContain("repo-a.git");
		}));

	test("arb create renders template with shareRemote.url", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/share.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.shareRemote.url }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-share", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-share/share.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-share/share.txt"), "utf8");
			expect(content).toContain("repo-a.git");
		}));

	test("arb create renders template with baseRemote.name", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/remote-names.txt.arbtemplate"),
				"{% for wt in workspace.repos %}{{ wt.baseRemote.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-rname", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-rname/remote-names.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-rname/remote-names.txt"), "utf8");
			// Single-remote repo: origin is used for both roles
			expect(content).toContain("origin");
		}));

	test("repo-scoped template accesses repo.baseRemote.url", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/repos/repo-a/base-url.txt.arbtemplate"),
				"{{ repo.baseRemote.url }}",
			);

			await arb(env, ["create", "tpl-repo-remote", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-repo-remote/repo-a/base-url.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-repo-remote/repo-a/base-url.txt"), "utf8");
			expect(content).toContain("repo-a.git");
		}));

	test("fork repo template renders upstream and origin remotes", () =>
		withEnv(async (env) => {
			await setupForkRepo(env, "repo-a");

			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(
				join(env.projectDir, ".arb/templates/workspace/fork-remotes.txt.arbtemplate"),
				"{% for wt in workspace.repos %}base={{ wt.baseRemote.name }} share={{ wt.shareRemote.name }}\n{% endfor %}",
			);

			await arb(env, ["create", "tpl-fork", "repo-a"]);
			expect(existsSync(join(env.projectDir, "tpl-fork/fork-remotes.txt"))).toBe(true);
			const content = await readFile(join(env.projectDir, "tpl-fork/fork-remotes.txt"), "utf8");
			expect(content).toContain("base=upstream");
			expect(content).toContain("share=origin");
		}));
});

// ── unknown template variable warnings ────────────────────────────

describe("unknown template variable warnings", () => {
	test("arb create warns on unknown template variable with full path", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/typo.txt.arbtemplate"), "{{ workspace.nam }}");

			const result = await arb(env, ["create", "tpl-unknown-warn", "repo-a"]);
			expect(result.exitCode).toBe(0);
			// Grouped warning header should appear
			expect(result.output).toContain("Unknown template variables");
			// Variable name and full template path should appear
			expect(result.output).toContain("'workspace.nam'");
			expect(result.output).toContain(".arb/templates/workspace/typo.txt.arbtemplate");
			// File should still be created (rendered as empty string)
			expect(existsSync(join(env.projectDir, "tpl-unknown-warn/typo.txt"))).toBe(true);
		}));

	test("arb create does not warn on valid template variables", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/valid.txt.arbtemplate"), "{{ workspace.name }}");

			const result = await arb(env, ["create", "tpl-valid-nowarn", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).not.toContain("Unknown template variables");
			expect(existsSync(join(env.projectDir, "tpl-valid-nowarn/valid.txt"))).toBe(true);
		}));

	test("arb template list warns on unknown template variables", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/typo.txt.arbtemplate"), "{{ workspace.nam }}");

			await arb(env, ["create", "tpl-list-warn", "repo-a"]);
			const result = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "tpl-list-warn"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Unknown template variables");
			expect(result.output).toContain("'workspace.nam'");
			expect(result.output).toContain(".arb/templates/workspace/typo.txt.arbtemplate");
		}));

	test("arb template apply --force shows reset count with N reset format", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await writeFile(join(env.projectDir, ".arb/templates/workspace/name.txt.arbtemplate"), "{{ workspace.name }}");

			await arb(env, ["create", "tpl-reset-fmt", "repo-a"]);
			await writeFile(join(env.projectDir, "tpl-reset-fmt/name.txt"), "wrong");
			const result = await arb(env, ["template", "apply", "--force"], {
				cwd: join(env.projectDir, "tpl-reset-fmt"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("1 reset");
		}));

	test("arb template apply aligns scope labels", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/.env"), "WS");
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "REPO");
			await arb(env, ["create", "tpl-align", "repo-a"]);
			const result = await arb(env, ["template", "apply"], {
				cwd: join(env.projectDir, "tpl-align"),
			});
			expect(result.exitCode).toBe(0);
			// Both lines should have consistent bracket formatting
			expect(result.output).toContain("[workspace]");
			expect(result.output).toContain("[repo-a]");
		}));
});

// ── template leak prevention ─────────────────────────────────────

describe("template leak prevention", () => {
	test("arb create does not create dirs for non-selected repo templates", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-a"), { recursive: true });
			await mkdir(join(env.projectDir, ".arb/templates/repos/repo-b"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/repos/repo-a/.env"), "A-ENV");
			await write(join(env.projectDir, ".arb/templates/repos/repo-b/.env"), "B-ENV");

			await arb(env, ["create", "leak-test", "repo-a"]);
			// repo-a template should be applied
			expect(existsSync(join(env.projectDir, "leak-test/repo-a/.env"))).toBe(true);
			// repo-b should NOT exist at all — no directory created
			expect(existsSync(join(env.projectDir, "leak-test/repo-b"))).toBe(false);
		}));

	test("arb template apply --repo rejects non-workspace repo", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "apply-reject", "repo-a"]);
			const result = await arb(env, ["template", "apply", "--repo", "repo-b"], {
				cwd: join(env.projectDir, "apply-reject"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("not in this workspace");
		}));

	test("arb template apply --force --repo rejects non-workspace repo", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "force-reject", "repo-a"]);
			const result = await arb(env, ["template", "apply", "--force", "--repo", "repo-b"], {
				cwd: join(env.projectDir, "force-reject"),
			});
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain("not in this workspace");
		}));

	test("arb create warns when workspace template sits in a repo-named directory", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/repo-a/config.txt"), "leaked");

			const result = await arb(env, ["create", "warn-repo-dir", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.output).toMatch(/repo-a.*repo-scoped templates/);
		}));

	test("arb template apply warns when workspace template sits in a repo-named directory", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "warn-apply", "repo-a"]);
			await mkdir(join(env.projectDir, ".arb/templates/workspace/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/repo-a/config.txt"), "leaked");

			const result = await arb(env, ["template", "apply"], {
				cwd: join(env.projectDir, "warn-apply"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toMatch(/repo-a.*repo-scoped templates/);
		}));

	test("arb template list warns when workspace template sits in a repo-named directory", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace/repo-a"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/repo-a/config.txt"), "leaked");

			// Detail section warning shows outside workspace
			const result1 = await arb(env, ["template", "list"]);
			expect(result1.exitCode).toBe(0);
			expect(result1.output).toMatch(/repo-a.*repo-scoped templates/);

			// STATUS column shows misplaced label inside workspace
			await arb(env, ["create", "warn-list", "repo-a"]);
			const result2 = await arb(env, ["template", "list"], {
				cwd: join(env.projectDir, "warn-list"),
			});
			expect(result2.exitCode).toBe(0);
			expect(result2.output).toContain("misplaced");
		}));
});

// ── unified display in lifecycle commands ─────────────────────────

describe("unified display in lifecycle commands", () => {
	test("arb detach shows seeded count when new template added during detach", () =>
		withEnv(async (env) => {
			await arb(env, ["create", "detach-seed", "repo-a", "repo-b"]);

			// Add a new workspace template AFTER create
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/new-file.txt"), "NEW");

			const result = await arb(env, ["detach", "repo-b"], {
				cwd: join(env.projectDir, "detach-seed"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Seeded 1 template file");
			expect(existsSync(join(env.projectDir, "detach-seed/new-file.txt"))).toBe(true);
		}));

	test("arb detach displays conflict warning when both plain and .arbtemplate exist", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/config.json"), "plain");
			await writeFile(join(env.projectDir, ".arb/templates/workspace/config.json.arbtemplate"), "{{ workspace.name }}");

			await arb(env, ["create", "detach-conflict", "repo-a", "repo-b"]);
			const result = await arb(env, ["detach", "repo-b"], {
				cwd: join(env.projectDir, "detach-conflict"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Conflicting templates");
			expect(result.output).toContain("config.json");
		}));

	test("arb attach uses grouped conflict format with remediation instructions", () =>
		withEnv(async (env) => {
			await mkdir(join(env.projectDir, ".arb/templates/workspace"), { recursive: true });
			await write(join(env.projectDir, ".arb/templates/workspace/config.json"), "plain");
			await writeFile(join(env.projectDir, ".arb/templates/workspace/config.json.arbtemplate"), "{{ workspace.name }}");

			await arb(env, ["create", "attach-conflict", "repo-a"]);
			const result = await arb(env, ["attach", "repo-b"], {
				cwd: join(env.projectDir, "attach-conflict"),
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Conflicting templates");
			expect(result.output).toContain("remove either");
			expect(result.output).toContain(".arb/templates/workspace/config.json");
		}));
});
