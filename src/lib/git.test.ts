import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	branchExistsLocally,
	checkBranchMatch,
	getDefaultBranch,
	hasRemote,
	isRepoDirty,
	parseGitStatus,
	validateBranchName,
	validateWorkspaceName,
} from "./git";

describe("validateWorkspaceName", () => {
	test("returns null for valid names", () => {
		expect(validateWorkspaceName("my-feature")).toBeNull();
		expect(validateWorkspaceName("v2")).toBeNull();
		expect(validateWorkspaceName("fix.bug")).toBeNull();
	});

	test("rejects names starting with '.'", () => {
		const result = validateWorkspaceName(".hidden");
		expect(result).toBeString();
		expect(result).toContain("must not start with '.'");
	});

	test("rejects names containing '/'", () => {
		const result = validateWorkspaceName("a/b");
		expect(result).toBeString();
		expect(result).toContain("must not contain '/'");
	});

	test("rejects names containing '..'", () => {
		const result = validateWorkspaceName("a..b");
		expect(result).toBeString();
		expect(result).toContain("must not contain '..'");
	});

	test("rejects names with whitespace", () => {
		expect(validateWorkspaceName("has space")).toContain("whitespace");
		expect(validateWorkspaceName("has\ttab")).toContain("whitespace");
		expect(validateWorkspaceName("has\nnewline")).toContain("whitespace");
	});
});

describe("validateBranchName", () => {
	test("accepts valid branch names", () => {
		expect(validateBranchName("feature/foo")).toBe(true);
		expect(validateBranchName("main")).toBe(true);
		expect(validateBranchName("fix-123")).toBe(true);
	});

	test("rejects empty string", () => {
		expect(validateBranchName("")).toBe(false);
	});

	test("rejects names with '..'", () => {
		expect(validateBranchName("..bad")).toBe(false);
	});

	test("rejects names with spaces", () => {
		expect(validateBranchName("bad name")).toBe(false);
	});

	test("rejects names with ~, ^, :", () => {
		expect(validateBranchName("bad~name")).toBe(false);
		expect(validateBranchName("bad^name")).toBe(false);
		expect(validateBranchName("bad:name")).toBe(false);
	});
});

describe("git repo functions", () => {
	let repoDir: string;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "arb-git-test-"));
		const bare = join(tmpDir, "bare.git");
		repoDir = join(tmpDir, "work");

		Bun.spawnSync(["git", "init", "--bare", bare]);
		Bun.spawnSync(["git", "clone", bare, repoDir]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
		Bun.spawnSync(["git", "-C", repoDir, "push", "origin", "HEAD"]);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("getDefaultBranch", () => {
		test("returns the HEAD branch name", async () => {
			const branch = await getDefaultBranch(repoDir);
			// git init defaults vary, but should be a non-empty string
			if (!branch) throw new Error("expected default branch");
			expect(branch.length).toBeGreaterThan(0);
		});
	});

	describe("hasRemote", () => {
		test("returns true for repo with remote", async () => {
			expect(await hasRemote(repoDir)).toBe(true);
		});

		test("returns false for repo without remote", async () => {
			const localDir = join(tmpDir, "local");
			Bun.spawnSync(["git", "init", localDir]);
			expect(await hasRemote(localDir)).toBe(false);
		});
	});

	describe("branchExistsLocally", () => {
		test("returns false for nonexistent branch", async () => {
			expect(await branchExistsLocally(repoDir, "no-such-branch")).toBe(false);
		});

		test("returns true after creating a branch", async () => {
			Bun.spawnSync(["git", "-C", repoDir, "branch", "test-branch"]);
			expect(await branchExistsLocally(repoDir, "test-branch")).toBe(true);
		});
	});

	describe("isRepoDirty", () => {
		test("returns false when clean", async () => {
			expect(await isRepoDirty(repoDir)).toBe(false);
		});

		test("returns true after modifying a file", async () => {
			writeFileSync(join(repoDir, "dirty.txt"), "change");
			expect(await isRepoDirty(repoDir)).toBe(true);
		});
	});

	describe("parseGitStatus", () => {
		test("returns zeros when clean", async () => {
			expect(await parseGitStatus(repoDir)).toEqual({ staged: 0, modified: 0, untracked: 0 });
		});

		test("counts untracked files", async () => {
			writeFileSync(join(repoDir, "new.txt"), "new");
			const status = await parseGitStatus(repoDir);
			expect(status.untracked).toBe(1);
			expect(status.staged).toBe(0);
			expect(status.modified).toBe(0);
		});

		test("counts staged files", async () => {
			writeFileSync(join(repoDir, "staged.txt"), "staged");
			Bun.spawnSync(["git", "-C", repoDir, "add", "staged.txt"]);
			const status = await parseGitStatus(repoDir);
			expect(status.staged).toBe(1);
		});

		test("counts modified files", async () => {
			writeFileSync(join(repoDir, "tracked.txt"), "initial");
			Bun.spawnSync(["git", "-C", repoDir, "add", "tracked.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add tracked"]);
			writeFileSync(join(repoDir, "tracked.txt"), "modified");
			const status = await parseGitStatus(repoDir);
			expect(status.modified).toBe(1);
		});
	});

	describe("checkBranchMatch", () => {
		test("matches when on expected branch", async () => {
			const defaultBranch = await getDefaultBranch(repoDir);
			if (!defaultBranch) throw new Error("expected default branch");
			const result = await checkBranchMatch(repoDir, defaultBranch);
			expect(result.matches).toBe(true);
			expect(result.actual).toBe(defaultBranch);
		});

		test("does not match when on different branch", async () => {
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "other"]);
			const result = await checkBranchMatch(repoDir, "main");
			expect(result.matches).toBe(false);
			expect(result.actual).toBe("other");
		});
	});
});
