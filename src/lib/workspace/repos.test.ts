import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRepos, listWorkspaces, workspaceRepoDirs } from "./repos";

describe("repos", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "arb-repos-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("listWorkspaces", () => {
		test("finds directories with .arbws marker", () => {
			mkdirSync(join(tmpDir, "ws-a"));
			writeFileSync(join(tmpDir, "ws-a", ".arbws"), "");
			mkdirSync(join(tmpDir, "ws-b"));
			writeFileSync(join(tmpDir, "ws-b", ".arbws"), "");

			expect(listWorkspaces(tmpDir)).toEqual(["ws-a", "ws-b"]);
		});

		test("skips dotfiles", () => {
			mkdirSync(join(tmpDir, ".hidden"));
			writeFileSync(join(tmpDir, ".hidden", ".arbws"), "");
			mkdirSync(join(tmpDir, "visible"));
			writeFileSync(join(tmpDir, "visible", ".arbws"), "");

			expect(listWorkspaces(tmpDir)).toEqual(["visible"]);
		});

		test("skips files (non-dirs)", () => {
			writeFileSync(join(tmpDir, "not-a-dir"), "");
			mkdirSync(join(tmpDir, "ws"));
			writeFileSync(join(tmpDir, "ws", ".arbws"), "");

			expect(listWorkspaces(tmpDir)).toEqual(["ws"]);
		});

		test("skips directories without .arbws", () => {
			mkdirSync(join(tmpDir, "no-marker"));
			mkdirSync(join(tmpDir, "has-marker"));
			writeFileSync(join(tmpDir, "has-marker", ".arbws"), "");

			expect(listWorkspaces(tmpDir)).toEqual(["has-marker"]);
		});

		test("returns sorted list", () => {
			for (const name of ["zeta", "alpha", "mid"]) {
				mkdirSync(join(tmpDir, name));
				writeFileSync(join(tmpDir, name, ".arbws"), "");
			}

			expect(listWorkspaces(tmpDir)).toEqual(["alpha", "mid", "zeta"]);
		});
	});

	describe("listRepos", () => {
		test("finds directories with .git marker", () => {
			mkdirSync(join(tmpDir, "repo-a", ".git"), { recursive: true });
			mkdirSync(join(tmpDir, "repo-b", ".git"), { recursive: true });

			expect(listRepos(tmpDir)).toEqual(["repo-a", "repo-b"]);
		});

		test("returns empty for nonexistent dir", () => {
			expect(listRepos(join(tmpDir, "nope"))).toEqual([]);
		});

		test("returns sorted list", () => {
			for (const name of ["zebra", "aardvark", "middle"]) {
				mkdirSync(join(tmpDir, name, ".git"), { recursive: true });
			}

			expect(listRepos(tmpDir)).toEqual(["aardvark", "middle", "zebra"]);
		});
	});

	describe("workspaceRepoDirs", () => {
		test("returns full paths", () => {
			mkdirSync(join(tmpDir, "repo-x", ".git"), { recursive: true });
			writeFileSync(join(tmpDir, ".arbws"), "");

			const result = workspaceRepoDirs(tmpDir);
			expect(result).toEqual([join(tmpDir, "repo-x")]);
		});

		test("skips .arbws marker", () => {
			mkdirSync(join(tmpDir, "repo", ".git"), { recursive: true });
			writeFileSync(join(tmpDir, ".arbws"), "");

			const result = workspaceRepoDirs(tmpDir);
			expect(result.some((p) => p.includes(".arbws"))).toBe(false);
		});

		test("returns empty for nonexistent dir", () => {
			expect(workspaceRepoDirs(join(tmpDir, "nope"))).toEqual([]);
		});

		test("returns sorted paths", () => {
			for (const name of ["z-repo", "a-repo", "m-repo"]) {
				mkdirSync(join(tmpDir, name, ".git"), { recursive: true });
			}
			writeFileSync(join(tmpDir, ".arbws"), "");

			const result = workspaceRepoDirs(tmpDir);
			expect(result).toEqual([join(tmpDir, "a-repo"), join(tmpDir, "m-repo"), join(tmpDir, "z-repo")]);
		});
	});
});
