import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyRepoTemplates,
	applyWorkspaceTemplates,
	detectTemplateScope,
	diffTemplates,
	forceOverlayDirectory,
	listTemplates,
	overlayDirectory,
	removeTemplate,
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
});
