import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRepoTemplates, applyWorkspaceTemplates, overlayDirectory } from "./templates";

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
});
