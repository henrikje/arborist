import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ARBTEMPLATE_EXT,
	type TemplateContext,
	applyRepoTemplates,
	applyWorkspaceTemplates,
	detectTemplateScope,
	diffTemplates,
	forceOverlayDirectory,
	listTemplates,
	overlayDirectory,
	removeTemplate,
	renderTemplate,
	templateFilePath,
} from "./templates";

describe("templates", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "arb-templates-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("overlayDirectory", () => {
		test("returns empty result when source directory does not exist", () => {
			const result = overlayDirectory(join(tmpDir, "nonexistent"), join(tmpDir, "dest"));
			expect(result.seeded).toEqual([]);
			expect(result.skipped).toEqual([]);
			expect(result.failed).toEqual([]);
		});

		test("copies files to destination", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "file.txt"), "hello");

			const result = overlayDirectory(src, dest);
			expect(result.seeded).toEqual(["file.txt"]);
			expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("hello");
		});

		test("handles nested directory structures", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(join(src, ".claude"), { recursive: true });
			mkdirSync(dest);
			writeFileSync(join(src, ".claude", "settings.local.json"), '{"key": "value"}');

			const result = overlayDirectory(src, dest);
			expect(result.seeded).toEqual([join(".claude", "settings.local.json")]);
			expect(readFileSync(join(dest, ".claude", "settings.local.json"), "utf-8")).toBe('{"key": "value"}');
		});

		test("skips existing files without overwriting", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "file.txt"), "new content");
			writeFileSync(join(dest, "file.txt"), "original content");

			const result = overlayDirectory(src, dest);
			expect(result.skipped).toEqual(["file.txt"]);
			expect(result.seeded).toEqual([]);
			expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("original content");
		});

		test("handles empty source directory", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);

			const result = overlayDirectory(src, dest);
			expect(result.seeded).toEqual([]);
			expect(result.skipped).toEqual([]);
		});

		test("skips symlinks", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "real.txt"), "content");
			symlinkSync(join(src, "real.txt"), join(src, "link.txt"));

			const result = overlayDirectory(src, dest);
			expect(result.seeded).toEqual(["real.txt"]);
			expect(existsSync(join(dest, "link.txt"))).toBe(false);
		});

		test("copies multiple files across nested directories", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(join(src, "a", "b"), { recursive: true });
			mkdirSync(dest);
			writeFileSync(join(src, "root.txt"), "r");
			writeFileSync(join(src, "a", "mid.txt"), "m");
			writeFileSync(join(src, "a", "b", "deep.txt"), "d");

			const result = overlayDirectory(src, dest);
			expect(result.seeded).toHaveLength(3);
			expect(readFileSync(join(dest, "root.txt"), "utf-8")).toBe("r");
			expect(readFileSync(join(dest, "a", "mid.txt"), "utf-8")).toBe("m");
			expect(readFileSync(join(dest, "a", "b", "deep.txt"), "utf-8")).toBe("d");
		});
	});

	describe("applyWorkspaceTemplates", () => {
		test("returns empty result when templates directory does not exist", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(tmpDir, "project", "ws");
			mkdirSync(wsDir, { recursive: true });

			const result = applyWorkspaceTemplates(baseDir, wsDir);
			expect(result.seeded).toEqual([]);
		});

		test("copies workspace templates to workspace root", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, ".env"), "KEY=value");

			const result = applyWorkspaceTemplates(baseDir, wsDir);
			expect(result.seeded).toEqual([".env"]);
			expect(readFileSync(join(wsDir, ".env"), "utf-8")).toBe("KEY=value");
		});

		test("copies nested workspace templates", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace", ".claude");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, "settings.local.json"), "{}");

			const result = applyWorkspaceTemplates(baseDir, wsDir);
			expect(result.seeded).toEqual([join(".claude", "settings.local.json")]);
			expect(existsSync(join(wsDir, ".claude", "settings.local.json"))).toBe(true);
		});
	});

	describe("applyRepoTemplates", () => {
		test("returns empty result when no template directories exist", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(wsDir, "api"), { recursive: true });

			const result = applyRepoTemplates(baseDir, wsDir, ["api"]);
			expect(result.seeded).toEqual([]);
		});

		test("copies repo templates to correct worktrees", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			mkdirSync(join(wsDir, "api"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "DB=localhost");

			const result = applyRepoTemplates(baseDir, wsDir, ["api"]);
			expect(result.seeded).toEqual([".env"]);
			expect(readFileSync(join(wsDir, "api", ".env"), "utf-8")).toBe("DB=localhost");
		});

		test("handles multiple repos", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			for (const repo of ["api", "web"]) {
				mkdirSync(join(baseDir, ".arb", "templates", "repos", repo), { recursive: true });
				mkdirSync(join(wsDir, repo), { recursive: true });
				writeFileSync(join(baseDir, ".arb", "templates", "repos", repo, ".env"), `APP=${repo}`);
			}

			const result = applyRepoTemplates(baseDir, wsDir, ["api", "web"]);
			expect(result.seeded).toHaveLength(2);
			expect(readFileSync(join(wsDir, "api", ".env"), "utf-8")).toBe("APP=api");
			expect(readFileSync(join(wsDir, "web", ".env"), "utf-8")).toBe("APP=web");
		});

		test("skips repos without template directories", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(wsDir, "api"), { recursive: true });
			mkdirSync(join(wsDir, "web"), { recursive: true });
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "yes");

			const result = applyRepoTemplates(baseDir, wsDir, ["api", "web"]);
			expect(result.seeded).toEqual([".env"]);
		});

		test("skips repos without worktree directories", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "yes");
			mkdirSync(wsDir, { recursive: true });

			const result = applyRepoTemplates(baseDir, wsDir, ["api"]);
			expect(result.seeded).toEqual([]);
		});
	});

	describe("diffTemplates", () => {
		test("returns empty array when no templates directory exists", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(wsDir, { recursive: true });

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([]);
		});

		test("returns empty array when workspace files match templates", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, ".env"), "KEY=value");
			writeFileSync(join(wsDir, ".env"), "KEY=value");

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([]);
		});

		test("detects modified workspace-scoped template files", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, ".env"), "KEY=value");
			writeFileSync(join(wsDir, ".env"), "KEY=custom");

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([{ relPath: ".env", scope: "workspace" }]);
		});

		test("detects modified repo-scoped template files", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			mkdirSync(join(wsDir, "api"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "DB=localhost");
			writeFileSync(join(wsDir, "api", ".env"), "DB=production");

			const result = diffTemplates(baseDir, wsDir, ["api"]);
			expect(result).toEqual([{ relPath: ".env", scope: "repo", repo: "api" }]);
		});

		test("skips files deleted from workspace", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, ".env"), "KEY=value");
			// No .env in wsDir — user deleted it

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([]);
		});

		test("skips symlinks in template directory", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, "real.txt"), "content");
			symlinkSync(join(templateDir, "real.txt"), join(templateDir, "link.txt"));
			writeFileSync(join(wsDir, "real.txt"), "modified");
			writeFileSync(join(wsDir, "link.txt"), "modified");

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([{ relPath: "real.txt", scope: "workspace" }]);
		});

		test("handles nested template directory structures", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace", ".claude"), { recursive: true });
			mkdirSync(join(wsDir, ".claude"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "workspace", ".claude", "settings.local.json"), "{}");
			writeFileSync(join(wsDir, ".claude", "settings.local.json"), '{"modified": true}');

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([{ relPath: join(".claude", "settings.local.json"), scope: "workspace" }]);
		});

		test("handles both workspace and repo diffs together", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			mkdirSync(join(wsDir, "api"), { recursive: true });

			writeFileSync(join(baseDir, ".arb", "templates", "workspace", ".env"), "WS=original");
			writeFileSync(join(wsDir, ".env"), "WS=modified");

			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "API=original");
			writeFileSync(join(wsDir, "api", ".env"), "API=modified");

			const result = diffTemplates(baseDir, wsDir, ["api"]);
			expect(result).toHaveLength(2);
			expect(result).toContainEqual({ relPath: ".env", scope: "workspace" });
			expect(result).toContainEqual({ relPath: ".env", scope: "repo", repo: "api" });
		});

		test("skips repos without worktree directories", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "yes");
			mkdirSync(wsDir, { recursive: true });

			const result = diffTemplates(baseDir, wsDir, ["api"]);
			expect(result).toEqual([]);
		});

		test("detects binary file differences", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });

			const templateBuf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
			const wsBuf = Buffer.from([0x00, 0x01, 0xff, 0x03]);
			writeFileSync(join(templateDir, "data.bin"), templateBuf);
			writeFileSync(join(wsDir, "data.bin"), wsBuf);

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([{ relPath: "data.bin", scope: "workspace" }]);
		});
	});

	describe("listTemplates", () => {
		test("returns empty array when no templates directory exists", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb"), { recursive: true });
			expect(listTemplates(baseDir)).toEqual([]);
		});

		test("lists workspace templates", () => {
			const baseDir = join(tmpDir, "project");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			writeFileSync(join(templateDir, ".env"), "KEY=value");

			const result = listTemplates(baseDir);
			expect(result).toEqual([{ scope: "workspace", relPath: ".env" }]);
		});

		test("lists repo templates", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "DB=localhost");

			const result = listTemplates(baseDir);
			expect(result).toEqual([{ scope: "repo", repo: "api", relPath: ".env" }]);
		});

		test("lists both workspace and repo templates", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "web"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "workspace", ".env"), "WS");
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", ".env"), "API");
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "web", ".env.local"), "WEB");

			const result = listTemplates(baseDir);
			expect(result).toHaveLength(3);
			expect(result).toContainEqual({ scope: "workspace", relPath: ".env" });
			expect(result).toContainEqual({ scope: "repo", repo: "api", relPath: ".env" });
			expect(result).toContainEqual({ scope: "repo", repo: "web", relPath: ".env.local" });
		});

		test("handles nested template files", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace", ".claude"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "workspace", ".claude", "settings.local.json"), "{}");

			const result = listTemplates(baseDir);
			expect(result).toEqual([{ scope: "workspace", relPath: join(".claude", "settings.local.json") }]);
		});
	});

	describe("detectTemplateScope", () => {
		test("returns workspace scope at workspace root", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			mkdirSync(join(wsDir, ".arbws"), { recursive: true });

			const result = detectTemplateScope(baseDir, wsDir);
			expect(result).toEqual({ scope: "workspace" });
		});

		test("returns repo scope inside a repo worktree", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			mkdirSync(join(wsDir, ".arbws"), { recursive: true });
			mkdirSync(join(wsDir, "api", ".git"), { recursive: true });

			const result = detectTemplateScope(baseDir, join(wsDir, "api"));
			expect(result).toEqual({ scope: "repo", repo: "api" });
		});

		test("returns null outside a workspace", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(baseDir, { recursive: true });

			const result = detectTemplateScope(baseDir, baseDir);
			expect(result).toBeNull();
		});

		test("returns null when CWD is outside baseDir", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(baseDir, { recursive: true });

			const result = detectTemplateScope(baseDir, "/tmp/somewhere-else");
			expect(result).toBeNull();
		});

		test("returns workspace scope when in workspace but not in a repo", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			mkdirSync(join(wsDir, ".arbws"), { recursive: true });
			mkdirSync(join(wsDir, "subdir"), { recursive: true });

			const result = detectTemplateScope(baseDir, join(wsDir, "subdir"));
			expect(result).toEqual({ scope: "workspace" });
		});
	});

	describe("removeTemplate", () => {
		test("removes a workspace template file", () => {
			const baseDir = join(tmpDir, "project");
			const templatePath = join(baseDir, ".arb", "templates", "workspace", ".env");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });
			writeFileSync(templatePath, "KEY=value");

			removeTemplate(baseDir, "workspace", ".env");
			expect(existsSync(templatePath)).toBe(false);
		});

		test("removes a repo template file", () => {
			const baseDir = join(tmpDir, "project");
			const templatePath = join(baseDir, ".arb", "templates", "repos", "api", ".env");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			writeFileSync(templatePath, "DB=localhost");

			removeTemplate(baseDir, "repo", ".env", "api");
			expect(existsSync(templatePath)).toBe(false);
		});

		test("cleans up empty parent directories", () => {
			const baseDir = join(tmpDir, "project");
			const nestedDir = join(baseDir, ".arb", "templates", "workspace", "config", "deep");
			mkdirSync(nestedDir, { recursive: true });
			writeFileSync(join(nestedDir, "settings.json"), "{}");

			removeTemplate(baseDir, "workspace", join("config", "deep", "settings.json"));
			expect(existsSync(nestedDir)).toBe(false);
			expect(existsSync(join(baseDir, ".arb", "templates", "workspace", "config"))).toBe(false);
			expect(existsSync(join(baseDir, ".arb", "templates", "workspace"))).toBe(true);
		});

		test("does not remove non-empty parent directories", () => {
			const baseDir = join(tmpDir, "project");
			const configDir = join(baseDir, ".arb", "templates", "workspace", "config");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "a.json"), "a");
			writeFileSync(join(configDir, "b.json"), "b");

			removeTemplate(baseDir, "workspace", join("config", "a.json"));
			expect(existsSync(join(configDir, "b.json"))).toBe(true);
			expect(existsSync(configDir)).toBe(true);
		});

		test("throws when template does not exist", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });

			expect(() => removeTemplate(baseDir, "workspace", "nonexistent.txt")).toThrow("Template does not exist");
		});
	});

	describe("forceOverlayDirectory", () => {
		test("returns empty result when source directory does not exist", () => {
			const result = forceOverlayDirectory(join(tmpDir, "nonexistent"), join(tmpDir, "dest"));
			expect(result.seeded).toEqual([]);
			expect(result.reset).toEqual([]);
			expect(result.unchanged).toEqual([]);
			expect(result.failed).toEqual([]);
		});

		test("seeds missing files", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "file.txt"), "hello");

			const result = forceOverlayDirectory(src, dest);
			expect(result.seeded).toEqual(["file.txt"]);
			expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("hello");
		});

		test("resets drifted files", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "file.txt"), "original");
			writeFileSync(join(dest, "file.txt"), "modified");

			const result = forceOverlayDirectory(src, dest);
			expect(result.reset).toEqual(["file.txt"]);
			expect(result.seeded).toEqual([]);
			expect(result.unchanged).toEqual([]);
			expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("original");
		});

		test("reports unchanged files", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "file.txt"), "same");
			writeFileSync(join(dest, "file.txt"), "same");

			const result = forceOverlayDirectory(src, dest);
			expect(result.unchanged).toEqual(["file.txt"]);
			expect(result.seeded).toEqual([]);
			expect(result.reset).toEqual([]);
		});

		test("handles mixed seeded, reset, and unchanged files", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "new.txt"), "new");
			writeFileSync(join(src, "drifted.txt"), "original");
			writeFileSync(join(dest, "drifted.txt"), "changed");
			writeFileSync(join(src, "same.txt"), "content");
			writeFileSync(join(dest, "same.txt"), "content");

			const result = forceOverlayDirectory(src, dest);
			expect(result.seeded).toEqual(["new.txt"]);
			expect(result.reset).toEqual(["drifted.txt"]);
			expect(result.unchanged).toEqual(["same.txt"]);
		});
	});

	// ── Liquid rendering ────────────────────────────────────────────

	describe("renderTemplate", () => {
		test("replaces all workspace variables", () => {
			const ctx: TemplateContext = {
				rootPath: "/projects/myapp",
				workspaceName: "feat-login",
				workspacePath: "/projects/myapp/feat-login",
			};
			const input = "root={{ root.path }} ws={{ workspace.name }} path={{ workspace.path }}";
			const result = renderTemplate(input, ctx);
			expect(result).toBe("root=/projects/myapp ws=feat-login path=/projects/myapp/feat-login");
		});

		test("replaces worktree variables when provided", () => {
			const ctx: TemplateContext = {
				rootPath: "/projects/myapp",
				workspaceName: "feat-login",
				workspacePath: "/projects/myapp/feat-login",
				worktreeName: "api",
				worktreePath: "/projects/myapp/feat-login/api",
			};
			const input = "wt={{ worktree.name }} wtpath={{ worktree.path }}";
			const result = renderTemplate(input, ctx);
			expect(result).toBe("wt=api wtpath=/projects/myapp/feat-login/api");
		});

		test("leaves worktree variables empty when not provided", () => {
			const ctx: TemplateContext = {
				rootPath: "/projects/myapp",
				workspaceName: "feat-login",
				workspacePath: "/projects/myapp/feat-login",
			};
			const input = "{{ worktree.name }} and {{ worktree.path }}";
			const result = renderTemplate(input, ctx);
			expect(result).toBe(" and ");
		});

		test("handles multiple occurrences of the same variable", () => {
			const ctx: TemplateContext = {
				rootPath: "/root",
				workspaceName: "ws",
				workspacePath: "/root/ws",
			};
			const input = "{{ workspace.name }}/{{ workspace.name }}/{{ workspace.name }}";
			const result = renderTemplate(input, ctx);
			expect(result).toBe("ws/ws/ws");
		});

		test("handles content with no variables", () => {
			const ctx: TemplateContext = {
				rootPath: "/root",
				workspaceName: "ws",
				workspacePath: "/root/ws",
			};
			const input = "no variables here";
			const result = renderTemplate(input, ctx);
			expect(result).toBe("no variables here");
		});

		test("renders for loop over workspace.worktrees", () => {
			const ctx: TemplateContext = {
				rootPath: "/root",
				workspaceName: "ws",
				workspacePath: "/root/ws",
				repos: [
					{ name: "api", path: "/root/ws/api" },
					{ name: "web", path: "/root/ws/web" },
				],
			};
			const input = "{% for wt in workspace.worktrees %}{{ wt.name }}\n{% endfor %}";
			const result = renderTemplate(input, ctx);
			expect(result).toBe("api\nweb\n");
		});

		test("renders forloop.last for trailing comma handling", () => {
			const ctx: TemplateContext = {
				rootPath: "/root",
				workspaceName: "ws",
				workspacePath: "/root/ws",
				repos: [
					{ name: "api", path: "/root/ws/api" },
					{ name: "web", path: "/root/ws/web" },
				],
			};
			const input =
				'{%- for wt in workspace.worktrees %}\n"{{ wt.name }}"{% unless forloop.last %},{% endunless %}{%- endfor %}';
			const result = renderTemplate(input, ctx);
			expect(result).toBe('\n"api",\n"web"');
		});

		test("renders whitespace-controlled tags", () => {
			const ctx: TemplateContext = {
				rootPath: "/root",
				workspaceName: "ws",
				workspacePath: "/root/ws",
				repos: [
					{ name: "api", path: "/root/ws/api" },
					{ name: "web", path: "/root/ws/web" },
				],
			};
			const input = "items:{%- for wt in workspace.worktrees %} {{ wt.name }}{%- endfor %}";
			const result = renderTemplate(input, ctx);
			expect(result).toBe("items: api web");
		});

		test("renders empty for loop when no repos", () => {
			const ctx: TemplateContext = {
				rootPath: "/root",
				workspaceName: "ws",
				workspacePath: "/root/ws",
				repos: [],
			};
			const input = "before{% for wt in workspace.worktrees %}{{ wt.name }}{% endfor %}after";
			const result = renderTemplate(input, ctx);
			expect(result).toBe("beforeafter");
		});
	});

	describe("overlayDirectory with .arbtemplate", () => {
		test("renders Liquid and strips extension", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, `config.json${ARBTEMPLATE_EXT}`), '{"path": "{{ workspace.path }}"}');

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "my-ws",
				workspacePath: dest,
			};
			const result = overlayDirectory(src, dest, ctx);
			expect(result.seeded).toEqual(["config.json"]);
			expect(readFileSync(join(dest, "config.json"), "utf-8")).toBe(`{"path": "${dest}"}`);
			expect(existsSync(join(dest, `config.json${ARBTEMPLATE_EXT}`))).toBe(false);
		});

		test("skips if stripped destination already exists", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, `file.txt${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(dest, "file.txt"), "existing");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = overlayDirectory(src, dest, ctx);
			expect(result.skipped).toEqual(["file.txt"]);
			expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("existing");
		});

		test("handles mix of template and regular files", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, `dynamic.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(src, "static.txt"), "plain content");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = overlayDirectory(src, dest, ctx);
			expect(result.seeded).toHaveLength(2);
			expect(readFileSync(join(dest, "dynamic.json"), "utf-8")).toBe("ws");
			expect(readFileSync(join(dest, "static.txt"), "utf-8")).toBe("plain content");
		});
	});

	describe("forceOverlayDirectory with .arbtemplate", () => {
		test("seeds .arbtemplate with Liquid rendering", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, `file.json${ARBTEMPLATE_EXT}`), "{{ workspace.path }}");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = forceOverlayDirectory(src, dest, ctx);
			expect(result.seeded).toEqual(["file.json"]);
			expect(readFileSync(join(dest, "file.json"), "utf-8")).toBe(dest);
		});

		test("reports unchanged when rendered content matches", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, `file.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(dest, "file.json"), "ws");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = forceOverlayDirectory(src, dest, ctx);
			expect(result.unchanged).toEqual(["file.json"]);
		});

		test("resets when rendered content differs", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, `file.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(dest, "file.json"), "old-value");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = forceOverlayDirectory(src, dest, ctx);
			expect(result.reset).toEqual(["file.json"]);
			expect(readFileSync(join(dest, "file.json"), "utf-8")).toBe("ws");
		});
	});

	describe("diffTemplates with .arbtemplate", () => {
		test("no drift when rendered content matches workspace file", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, `config.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(wsDir, "config.json"), "my-ws");

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([]);
		});

		test("detects drift when rendered content differs", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, `config.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(wsDir, "config.json"), "wrong-value");

			const result = diffTemplates(baseDir, wsDir, []);
			expect(result).toEqual([{ relPath: "config.json", scope: "workspace" }]);
		});

		test("handles repo-scoped .arbtemplate with worktree variables", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			mkdirSync(join(wsDir, "api"), { recursive: true });
			writeFileSync(
				join(baseDir, ".arb", "templates", "repos", "api", `settings.json${ARBTEMPLATE_EXT}`),
				"{{ worktree.path }}",
			);
			writeFileSync(join(wsDir, "api", "settings.json"), join(wsDir, "api"));

			const result = diffTemplates(baseDir, wsDir, ["api"]);
			expect(result).toEqual([]);
		});
	});

	describe("listTemplates with .arbtemplate", () => {
		test("strips extension and sets isTemplate flag", () => {
			const baseDir = join(tmpDir, "project");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			writeFileSync(join(templateDir, `config.json${ARBTEMPLATE_EXT}`), "content");

			const result = listTemplates(baseDir);
			expect(result).toEqual([{ scope: "workspace", relPath: "config.json", isTemplate: true }]);
		});

		test("regular files have no isTemplate flag", () => {
			const baseDir = join(tmpDir, "project");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			writeFileSync(join(templateDir, "plain.txt"), "content");

			const result = listTemplates(baseDir);
			expect(result).toEqual([{ scope: "workspace", relPath: "plain.txt" }]);
		});

		test("handles mix of .arbtemplate and regular files", () => {
			const baseDir = join(tmpDir, "project");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			writeFileSync(join(templateDir, `dynamic.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(templateDir, "static.txt"), "plain");

			const result = listTemplates(baseDir);
			expect(result).toHaveLength(2);
			expect(result).toContainEqual({ scope: "workspace", relPath: "dynamic.json", isTemplate: true });
			expect(result).toContainEqual({ scope: "workspace", relPath: "static.txt" });
		});
	});

	describe("removeTemplate with .arbtemplate", () => {
		test("removes .arbtemplate file when called with stripped name", () => {
			const baseDir = join(tmpDir, "project");
			const templatePath = join(baseDir, ".arb", "templates", "workspace", `config.json${ARBTEMPLATE_EXT}`);
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });
			writeFileSync(templatePath, "{{ workspace.name }}");

			removeTemplate(baseDir, "workspace", "config.json");
			expect(existsSync(templatePath)).toBe(false);
		});

		test("prefers plain file over .arbtemplate when both exist", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });
			const plainPath = join(baseDir, ".arb", "templates", "workspace", "config.json");
			const arbtplPath = join(baseDir, ".arb", "templates", "workspace", `config.json${ARBTEMPLATE_EXT}`);
			writeFileSync(plainPath, "plain");
			writeFileSync(arbtplPath, "template");

			removeTemplate(baseDir, "workspace", "config.json");
			expect(existsSync(plainPath)).toBe(false);
			expect(existsSync(arbtplPath)).toBe(true);
		});
	});

	describe("templateFilePath with .arbtemplate", () => {
		test("resolves .arbtemplate variant when plain path does not exist", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });
			const arbtplPath = join(baseDir, ".arb", "templates", "workspace", `config.json${ARBTEMPLATE_EXT}`);
			writeFileSync(arbtplPath, "content");

			const result = templateFilePath(baseDir, "workspace", "config.json");
			expect(result).toBe(arbtplPath);
		});

		test("returns plain path when both exist", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });
			const plainPath = join(baseDir, ".arb", "templates", "workspace", "config.json");
			const arbtplPath = join(baseDir, ".arb", "templates", "workspace", `config.json${ARBTEMPLATE_EXT}`);
			writeFileSync(plainPath, "plain");
			writeFileSync(arbtplPath, "template");

			const result = templateFilePath(baseDir, "workspace", "config.json");
			expect(result).toBe(plainPath);
		});

		test("returns plain path when neither exists", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "workspace"), { recursive: true });

			const result = templateFilePath(baseDir, "workspace", "config.json");
			expect(result).toBe(join(baseDir, ".arb", "templates", "workspace", "config.json"));
		});
	});

	describe("overlayDirectory conflict detection", () => {
		test("reports conflict when both plain and .arbtemplate exist", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "config.json"), "plain");
			writeFileSync(join(src, `config.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = overlayDirectory(src, dest, ctx);
			// One should be seeded, the other should be in failed
			expect(result.seeded).toHaveLength(1);
			expect(result.failed).toHaveLength(1);
			expect(result.failed[0]?.path).toBe("config.json");
			expect(result.failed[0]?.error).toContain("Conflict");
			expect(result.failed[0]?.error).toContain(ARBTEMPLATE_EXT);
		});

		test("non-conflicting files are unaffected by conflict detection", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "a.json"), "a");
			writeFileSync(join(src, `b.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = overlayDirectory(src, dest, ctx);
			expect(result.seeded).toHaveLength(2);
			expect(result.failed).toEqual([]);
		});
	});

	describe("forceOverlayDirectory conflict detection", () => {
		test("reports conflict when both plain and .arbtemplate exist", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "config.json"), "plain");
			writeFileSync(join(src, `config.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = forceOverlayDirectory(src, dest, ctx);
			// One should be seeded, the other should be in failed
			expect(result.seeded).toHaveLength(1);
			expect(result.failed).toHaveLength(1);
			expect(result.failed[0]?.path).toBe("config.json");
			expect(result.failed[0]?.error).toContain("Conflict");
		});

		test("non-conflicting files are unaffected by conflict detection", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "a.json"), "a");
			writeFileSync(join(src, `b.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
			};
			const result = forceOverlayDirectory(src, dest, ctx);
			expect(result.seeded).toHaveLength(2);
			expect(result.failed).toEqual([]);
		});
	});

	describe("listTemplates conflict detection", () => {
		test("deduplicates and flags conflict when both plain and .arbtemplate exist", () => {
			const baseDir = join(tmpDir, "project");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			writeFileSync(join(templateDir, "config.json"), "plain");
			writeFileSync(join(templateDir, `config.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");

			const result = listTemplates(baseDir);
			expect(result).toHaveLength(1);
			const entry = result[0];
			expect(entry?.relPath).toBe("config.json");
			expect(entry?.conflict).toBe(true);
		});

		test("prefers plain file entry over .arbtemplate when both exist", () => {
			const baseDir = join(tmpDir, "project");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			writeFileSync(join(templateDir, "config.json"), "plain");
			writeFileSync(join(templateDir, `config.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");

			const result = listTemplates(baseDir);
			expect(result).toHaveLength(1);
			// The kept entry should be the plain one (not isTemplate)
			expect(result[0]?.isTemplate).toBeUndefined();
		});

		test("flags conflict for repo-scoped templates too", () => {
			const baseDir = join(tmpDir, "project");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", "config.json"), "plain");
			writeFileSync(join(baseDir, ".arb", "templates", "repos", "api", `config.json${ARBTEMPLATE_EXT}`), "tpl");

			const result = listTemplates(baseDir);
			expect(result).toHaveLength(1);
			expect(result[0]?.conflict).toBe(true);
			expect(result[0]?.scope).toBe("repo");
			expect(result[0]?.repo).toBe("api");
		});

		test("no conflict flag when only one variant exists", () => {
			const baseDir = join(tmpDir, "project");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			writeFileSync(join(templateDir, "plain.txt"), "content");
			writeFileSync(join(templateDir, `dynamic.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");

			const result = listTemplates(baseDir);
			expect(result).toHaveLength(2);
			for (const entry of result) {
				expect(entry.conflict).toBeUndefined();
			}
		});
	});

	describe("applyWorkspaceTemplates with .arbtemplate", () => {
		test("renders workspace variables", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(join(templateDir, `config.json${ARBTEMPLATE_EXT}`), "{{ workspace.name }}:{{ workspace.path }}");

			const result = applyWorkspaceTemplates(baseDir, wsDir);
			expect(result.seeded).toEqual(["config.json"]);
			expect(readFileSync(join(wsDir, "config.json"), "utf-8")).toBe(`my-ws:${wsDir}`);
		});
	});

	describe("applyRepoTemplates with .arbtemplate", () => {
		test("renders repo variables including worktree fields", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			mkdirSync(join(baseDir, ".arb", "templates", "repos", "api"), { recursive: true });
			mkdirSync(join(wsDir, "api"), { recursive: true });
			writeFileSync(
				join(baseDir, ".arb", "templates", "repos", "api", `config.json${ARBTEMPLATE_EXT}`),
				"{{ worktree.name }}:{{ worktree.path }}",
			);

			const result = applyRepoTemplates(baseDir, wsDir, ["api"]);
			expect(result.seeded).toEqual(["config.json"]);
			expect(readFileSync(join(wsDir, "api", "config.json"), "utf-8")).toBe(`api:${join(wsDir, "api")}`);
		});
	});

	// ── Previous-state comparison (membership change) ──────────────

	describe("overlayDirectory with previousRepos (membership change)", () => {
		test("regenerates when output changed and user has not edited", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(
				join(src, `list.txt${ARBTEMPLATE_EXT}`),
				"{% for wt in workspace.worktrees %}{{ wt.name }}\n{% endfor %}",
			);
			// Simulate previous render with just "api"
			writeFileSync(join(dest, "list.txt"), "api\n");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
				repos: [
					{ name: "api", path: `${dest}/api` },
					{ name: "web", path: `${dest}/web` },
				],
				previousRepos: [{ name: "api", path: `${dest}/api` }],
			};
			const result = overlayDirectory(src, dest, ctx);
			expect(result.regenerated).toEqual(["list.txt"]);
			expect(readFileSync(join(dest, "list.txt"), "utf-8")).toBe("api\nweb\n");
		});

		test("skips when user has edited the file", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(
				join(src, `list.txt${ARBTEMPLATE_EXT}`),
				"{% for wt in workspace.worktrees %}{{ wt.name }}\n{% endfor %}",
			);
			// User has manually edited the file
			writeFileSync(join(dest, "list.txt"), "api\nmy-custom-entry\n");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
				repos: [
					{ name: "api", path: `${dest}/api` },
					{ name: "web", path: `${dest}/web` },
				],
				previousRepos: [{ name: "api", path: `${dest}/api` }],
			};
			const result = overlayDirectory(src, dest, ctx);
			expect(result.skipped).toEqual(["list.txt"]);
			expect(result.regenerated).toEqual([]);
			// File should NOT be overwritten
			expect(readFileSync(join(dest, "list.txt"), "utf-8")).toBe("api\nmy-custom-entry\n");
		});

		test("skips when new render matches existing content (unchanged)", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, `name.txt${ARBTEMPLATE_EXT}`), "{{ workspace.name }}");
			writeFileSync(join(dest, "name.txt"), "ws");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
				repos: [{ name: "api", path: `${dest}/api` }],
				previousRepos: [],
			};
			const result = overlayDirectory(src, dest, ctx);
			// Template output doesn't depend on worktrees, so new == old
			expect(result.skipped).toEqual(["name.txt"]);
			expect(result.regenerated).toEqual([]);
		});

		test("non-template files skip normally during membership change", () => {
			const src = join(tmpDir, "src");
			const dest = join(tmpDir, "dest");
			mkdirSync(src);
			mkdirSync(dest);
			writeFileSync(join(src, "static.txt"), "content");
			writeFileSync(join(dest, "static.txt"), "content");

			const ctx: TemplateContext = {
				rootPath: tmpDir,
				workspaceName: "ws",
				workspacePath: dest,
				repos: [{ name: "api", path: `${dest}/api` }],
				previousRepos: [],
			};
			const result = overlayDirectory(src, dest, ctx);
			expect(result.skipped).toEqual(["static.txt"]);
		});
	});

	describe("applyWorkspaceTemplates with membership change", () => {
		test("regenerates worktree-aware template on attach", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(join(wsDir, ".arbws"), { recursive: true });
			// Create two repo dirs with .git markers
			for (const repo of ["api", "web"]) {
				mkdirSync(join(wsDir, repo, ".git"), { recursive: true });
			}
			writeFileSync(
				join(templateDir, `repos.txt${ARBTEMPLATE_EXT}`),
				"{% for wt in workspace.worktrees %}{{ wt.name }}\n{% endfor %}",
			);
			// Simulate previous state: only "api"
			writeFileSync(join(wsDir, "repos.txt"), "api\n");

			const result = applyWorkspaceTemplates(baseDir, wsDir, { added: ["web"] });
			expect(result.regenerated).toEqual(["repos.txt"]);
			expect(readFileSync(join(wsDir, "repos.txt"), "utf-8")).toBe("api\nweb\n");
		});

		test("skips user-edited file on membership change", () => {
			const baseDir = join(tmpDir, "project");
			const wsDir = join(baseDir, "my-ws");
			const templateDir = join(baseDir, ".arb", "templates", "workspace");
			mkdirSync(templateDir, { recursive: true });
			mkdirSync(join(wsDir, ".arbws"), { recursive: true });
			for (const repo of ["api", "web"]) {
				mkdirSync(join(wsDir, repo, ".git"), { recursive: true });
			}
			writeFileSync(
				join(templateDir, `repos.txt${ARBTEMPLATE_EXT}`),
				"{% for wt in workspace.worktrees %}{{ wt.name }}\n{% endfor %}",
			);
			// User has edited the file
			writeFileSync(join(wsDir, "repos.txt"), "my custom content\n");

			const result = applyWorkspaceTemplates(baseDir, wsDir, { added: ["web"] });
			expect(result.skipped).toContain("repos.txt");
			expect(result.regenerated).toEqual([]);
			expect(readFileSync(join(wsDir, "repos.txt"), "utf-8")).toBe("my custom content\n");
		});
	});
});
