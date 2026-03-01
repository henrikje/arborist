import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analyzeRetargetReplay,
	branchExistsLocally,
	checkBranchMatch,
	detectBranchMerged,
	detectRebasedCommits,
	findMergeCommitForBranch,
	findTicketReferencedCommit,
	getCommitsBetweenFull,
	getDefaultBranch,
	isRepoDirty,
	matchDivergedCommits,
	parseDiffShortstat,
	parseGitStatus,
	predictMergeConflict,
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

	const configureGitIdentity = (dir: string) => {
		Bun.spawnSync(["git", "-C", dir, "config", "user.name", "Arborist Test"]);
		Bun.spawnSync(["git", "-C", dir, "config", "user.email", "arborist-test@example.com"]);
		Bun.spawnSync(["git", "-C", dir, "config", "commit.gpgsign", "false"]);
	};

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "arb-git-test-"));
		const bare = join(tmpDir, "bare.git");
		repoDir = join(tmpDir, "work");

		Bun.spawnSync(["git", "init", "--bare", bare]);
		Bun.spawnSync(["git", "clone", bare, repoDir]);
		configureGitIdentity(repoDir);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
		Bun.spawnSync(["git", "-C", repoDir, "push", "origin", "HEAD"]);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("getDefaultBranch", () => {
		test("returns the HEAD branch name", async () => {
			const branch = await getDefaultBranch(repoDir, "origin");
			// git init defaults vary, but should be a non-empty string
			if (!branch) throw new Error("expected default branch");
			expect(branch.length).toBeGreaterThan(0);
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
			expect(await parseGitStatus(repoDir)).toEqual({ staged: 0, modified: 0, untracked: 0, conflicts: 0 });
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
			const defaultBranch = await getDefaultBranch(repoDir, "origin");
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

	describe("predictMergeConflict", () => {
		test("returns clean for non-conflicting merge", async () => {
			// Create a feature branch with a non-overlapping change
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// Add a different change on the default branch
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "main.txt"), "main content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "main.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main commit"]);

			// Go back to feature and predict
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await predictMergeConflict(repoDir, defaultBranch);
			if (!result) throw new Error("expected non-null result");
			expect(result.hasConflict).toBe(false);
			expect(result.files).toEqual([]);
		});

		test("returns conflict for overlapping changes", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create a shared file on the default branch (common ancestor)
			writeFileSync(join(repoDir, "shared.txt"), "original");
			Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add shared"]);

			// Create a feature branch from here and make a conflicting change
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "shared.txt"), "feature version");
			Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature change"]);

			// Add a conflicting change on the default branch
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "shared.txt"), "main version");
			Bun.spawnSync(["git", "-C", repoDir, "add", "shared.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main change"]);

			// Go back to feature and predict
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await predictMergeConflict(repoDir, defaultBranch);
			if (!result) throw new Error("expected non-null result");
			expect(result.hasConflict).toBe(true);
			expect(result.files.length).toBeGreaterThan(0);
		});

		test("returns null for invalid ref", async () => {
			const result = await predictMergeConflict(repoDir, "nonexistent-ref");
			expect(result).toBeNull();
		});
	});

	describe("detectRebasedCommits", () => {
		test("detects rebased commits after rebase onto advanced main", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with two commits
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content a");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
			writeFileSync(join(repoDir, "b.txt"), "content b");
			Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

			// Push feature to origin
			Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

			// Advance main with a new commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "main-new.txt"), "main advance");
			Bun.spawnSync(["git", "-C", repoDir, "add", "main-new.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "advance main"]);
			Bun.spawnSync(["git", "-C", repoDir, "push", "origin", defaultBranch]);

			// Rebase feature onto advanced main
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			Bun.spawnSync(["git", "-C", repoDir, "rebase", defaultBranch]);

			// Now local feature has rebased commits, origin/feature has old ones
			const result = await detectRebasedCommits(repoDir, "origin/feature");
			expect(result).not.toBeNull();
			if (!result) throw new Error("expected non-null result");
			expect(result.count).toBe(2);
			expect(result.rebasedLocalHashes.size).toBe(2);
		});

		test("returns zero for genuinely different commits", async () => {
			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// Push feature
			Bun.spawnSync(["git", "-C", repoDir, "push", "-u", "origin", "feature"]);

			// Add different commit locally (not a rebase)
			writeFileSync(join(repoDir, "new.txt"), "new content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "new.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "new local commit"]);

			// Add different commit on the remote side (simulate via bare)
			const bare = join(tmpDir, "bare.git");
			const tmpClone = join(tmpDir, "tmpclone");
			Bun.spawnSync(["git", "clone", bare, tmpClone]);
			configureGitIdentity(tmpClone);
			Bun.spawnSync(["git", "-C", tmpClone, "checkout", "feature"]);
			writeFileSync(join(tmpClone, "remote-new.txt"), "remote content");
			Bun.spawnSync(["git", "-C", tmpClone, "add", "remote-new.txt"]);
			Bun.spawnSync(["git", "-C", tmpClone, "commit", "-m", "remote commit"]);
			Bun.spawnSync(["git", "-C", tmpClone, "push", "origin", "feature"]);

			// Fetch in our working repo
			Bun.spawnSync(["git", "-C", repoDir, "fetch", "origin"]);

			const result = await detectRebasedCommits(repoDir, "origin/feature");
			expect(result).not.toBeNull();
			if (!result) throw new Error("expected non-null result");
			expect(result.count).toBe(0);
			expect(result.rebasedLocalHashes.size).toBe(0);
		});

		test("returns zero or null for invalid ref", async () => {
			const result = await detectRebasedCommits(repoDir, "nonexistent-ref");
			// Piped commands may succeed with empty output or fail — either is acceptable
			if (result !== null) {
				expect(result.count).toBe(0);
				expect(result.rebasedLocalHashes.size).toBe(0);
			}
		});
	});

	describe("getCommitsBetweenFull", () => {
		test("returns short and full hashes with subjects", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create a feature branch with commits
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "x.txt"), "x");
			Bun.spawnSync(["git", "-C", repoDir, "add", "x.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add x"]);

			const commits = await getCommitsBetweenFull(repoDir, defaultBranch, "feature");
			expect(commits.length).toBe(1);
			expect(commits[0]?.shortHash.length).toBeGreaterThan(0);
			expect(commits[0]?.fullHash.length).toBe(40);
			expect(commits[0]?.subject).toBe("add x");
		});

		test("returns empty array for equal refs", async () => {
			const commits = await getCommitsBetweenFull(repoDir, "HEAD", "HEAD");
			expect(commits).toEqual([]);
		});
	});

	describe("detectBranchMerged", () => {
		test("detects merge commit", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// Merge feature into main
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync(["git", "-C", repoDir, "merge", "feature", "--no-ff", "-m", "merge feature"]);

			// Back on feature — HEAD is ancestor of main via the merge commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await detectBranchMerged(repoDir, defaultBranch);
			expect(result?.kind).toBe("merge");
		});

		test("detects single-commit rebase merge via patch-id", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
			const featureSha = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

			// Diverge main AFTER feature was created, then cherry-pick
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "main-work.txt"), "main work");
			Bun.spawnSync(["git", "-C", repoDir, "add", "main-work.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main work"]);
			Bun.spawnSync(["git", "-C", repoDir, "cherry-pick", featureSha]);

			// Back on feature — not an ancestor (main diverged), but patch-id matches
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await detectBranchMerged(repoDir, defaultBranch);
			expect(result?.kind).toBe("squash");
			expect(result?.matchingCommit).toBeDefined();
			expect(result?.matchingCommit?.subject).toBe("feature commit");
		});

		test("detects squash merge via patch-id", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with multiple commits
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content a");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
			writeFileSync(join(repoDir, "b.txt"), "content b");
			Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

			// Squash merge onto main
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: add a and b (#42)"]);

			// Back on feature — not an ancestor, but cumulative patch-id matches
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await detectBranchMerged(repoDir, defaultBranch);
			expect(result?.kind).toBe("squash");
			expect(result?.matchingCommit?.subject).toBe("squash: add a and b (#42)");
		});

		test("returns null for unmerged branch", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit (don't merge it)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			const result = await detectBranchMerged(repoDir, defaultBranch);
			expect(result).toBeNull();
		});

		test("returns null for modified squash (patch-id mismatch)", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// "Squash merge" but with modifications (not matching the branch diff)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "feature.txt"), "modified content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "modified squash"]);

			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await detectBranchMerged(repoDir, defaultBranch);
			expect(result).toBeNull();
		});

		test("returns merge for empty branch (no commits ahead of base)", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch at same point as main (no extra commits)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);

			const result = await detectBranchMerged(repoDir, defaultBranch);
			// HEAD is trivially an ancestor of main (they're the same commit)
			expect(result?.kind).toBe("merge");
		});

		test("respects commit limit", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// Squash merge onto main
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash merge"]);

			// Add more commits on main to push the squash commit beyond limit
			for (let i = 0; i < 3; i++) {
				writeFileSync(join(repoDir, `extra-${i}.txt`), `extra ${i}`);
				Bun.spawnSync(["git", "-C", repoDir, "add", `extra-${i}.txt`]);
				Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", `extra ${i}`]);
			}

			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			// With limit=1, only the most recent commit is checked — squash merge is older
			const limited = await detectBranchMerged(repoDir, defaultBranch, 1);
			expect(limited).toBeNull();

			// With default limit, it should be found
			const full = await detectBranchMerged(repoDir, defaultBranch);
			expect(full?.kind).toBe("squash");
		});

		test("detects merge commit with explicit branchRef", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create a base branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/auth"]);
			writeFileSync(join(repoDir, "auth.txt"), "auth content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "auth.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "auth feature"]);

			// Merge feat/auth into main via merge commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync(["git", "-C", repoDir, "merge", "feat/auth", "--no-ff", "-m", "merge auth"]);

			// Check if feat/auth has been merged into main using explicit branchRef
			const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feat/auth");
			expect(result?.kind).toBe("merge");
		});

		test("detects squash merge with explicit branchRef", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create a base branch with commits
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/auth"]);
			writeFileSync(join(repoDir, "auth.txt"), "auth content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "auth.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "auth feature"]);

			// Squash merge feat/auth into main
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feat/auth"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: auth"]);

			// Check if feat/auth has been squash-merged into main using explicit branchRef
			const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feat/auth");
			expect(result?.kind).toBe("squash");
		});

		test("returns null with explicit branchRef when not merged", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create a base branch with a commit (not merged into main)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/auth"]);
			writeFileSync(join(repoDir, "auth.txt"), "auth content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "auth.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "auth feature"]);

			// Check from main — feat/auth is NOT merged
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			const result = await detectBranchMerged(repoDir, defaultBranch, 200, "feat/auth");
			expect(result).toBeNull();
		});
	});

	describe("analyzeRetargetReplay", () => {
		test("identifies commits already on new target via patch-id", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create old base branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/old-base"]);
			writeFileSync(join(repoDir, "base.txt"), "base content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "base.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "base commit"]);

			// Create feature branch from old-base with two commits
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content a");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
			writeFileSync(join(repoDir, "b.txt"), "content b");
			Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

			// On default branch, cherry-pick "add a" (simulating it was merged)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			// Get the SHA of the "add a" commit from feature
			const logResult = Bun.spawnSync(["git", "-C", repoDir, "log", "feature", "--format=%H", "-2"]);
			const shas = logResult.stdout.toString().trim().split("\n");
			const addASha = shas[1] ?? "";
			Bun.spawnSync(["git", "-C", repoDir, "cherry-pick", addASha]);

			// Switch to feature branch for analysis
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);

			const result = await analyzeRetargetReplay(repoDir, "feat/old-base", defaultBranch);
			expect(result).not.toBeNull();
			if (!result) throw new Error("expected non-null result");
			expect(result.totalLocal).toBe(2);
			expect(result.alreadyOnTarget).toBe(1); // "add a" matches
			expect(result.toReplay).toBe(1); // "add b" needs replay
		});

		test("returns all to replay when no commits match", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create old base branch
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/old-base"]);
			writeFileSync(join(repoDir, "base.txt"), "base content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "base.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "base commit"]);

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// Default branch has different commits
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "main-new.txt"), "main content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "main-new.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main commit"]);

			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);

			const result = await analyzeRetargetReplay(repoDir, "feat/old-base", defaultBranch);
			expect(result).not.toBeNull();
			if (!result) throw new Error("expected non-null result");
			expect(result.totalLocal).toBe(1);
			expect(result.alreadyOnTarget).toBe(0);
			expect(result.toReplay).toBe(1);
		});

		test("returns zero local when feature has no commits beyond old base", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create old base branch
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feat/old-base"]);

			// Feature at same point as old-base (no extra commits)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);

			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await analyzeRetargetReplay(repoDir, "feat/old-base", defaultBranch);
			expect(result).not.toBeNull();
			if (!result) throw new Error("expected non-null result");
			expect(result.totalLocal).toBe(0);
			expect(result.alreadyOnTarget).toBe(0);
			expect(result.toReplay).toBe(0);
		});
	});

	describe("matchDivergedCommits", () => {
		test("detects 1:1 rebase match when commit is cherry-picked onto base", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
			const featureSha = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

			// Diverge main first with a different commit, then cherry-pick
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "main-work.txt"), "main work");
			Bun.spawnSync(["git", "-C", repoDir, "add", "main-work.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main work"]);
			Bun.spawnSync(["git", "-C", repoDir, "cherry-pick", featureSha]);
			const cherryPickSha = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

			// Back on feature — diverged: 1 ahead, 2 behind (main-work + cherry-pick)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await matchDivergedCommits(repoDir, defaultBranch);
			expect(result.rebaseMatches.size).toBe(1);
			expect(result.rebaseMatches.get(cherryPickSha)).toBe(featureSha);
			expect(result.squashMatch).toBeNull();
		});

		test("detects full squash match when branch is squash-merged onto base", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with multiple commits
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content a");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add a"]);
			writeFileSync(join(repoDir, "b.txt"), "content b");
			Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "add b"]);

			// Squash merge onto main
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync(["git", "-C", repoDir, "merge", "--squash", "feature"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "squash: add a and b"]);
			const squashSha = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

			// Back on feature — diverged: 2 ahead, 1 behind (the squash commit)
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await matchDivergedCommits(repoDir, defaultBranch);
			expect(result.rebaseMatches.size).toBe(0);
			expect(result.squashMatch).not.toBeNull();
			if (!result.squashMatch) throw new Error("expected squashMatch");
			expect(result.squashMatch.incomingHash).toBe(squashSha);
			expect(result.squashMatch.localHashes.length).toBe(2);
		});

		test("returns empty result for genuinely different commits", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// Add a different commit on main
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			writeFileSync(join(repoDir, "main.txt"), "main content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "main.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "main commit"]);

			// Back on feature
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await matchDivergedCommits(repoDir, defaultBranch);
			expect(result.rebaseMatches.size).toBe(0);
			expect(result.squashMatch).toBeNull();
		});

		test("returns empty result for equal refs", async () => {
			const result = await matchDivergedCommits(repoDir, "HEAD");
			expect(result.rebaseMatches.size).toBe(0);
			expect(result.squashMatch).toBeNull();
		});
	});

	describe("findMergeCommitForBranch", () => {
		test("finds merge commit with afterRef scoping", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
			const featureHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

			// Merge feature into default branch
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync([
				"git",
				"-C",
				repoDir,
				"merge",
				"feature",
				"--no-ff",
				"-m",
				"Merge pull request #42 from user/feature",
			]);

			// Back on feature — use HEAD (feature tip) as afterRef
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature", 50, featureHead);
			expect(result).not.toBeNull();
			expect(result?.subject).toContain("feature");
		});

		test("works without afterRef (backward compatible)", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);

			// Merge feature into default branch
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync([
				"git",
				"-C",
				repoDir,
				"merge",
				"feature",
				"--no-ff",
				"-m",
				"Merge pull request #42 from user/feature",
			]);

			// Back on feature — no afterRef
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature");
			expect(result).not.toBeNull();
			expect(result?.subject).toContain("feature");
		});

		test("finds merge commit by parentage when subject does not contain branch name", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
			const featureHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

			// Merge with a generic subject that does NOT contain "feature"
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync([
				"git",
				"-C",
				repoDir,
				"merge",
				"feature",
				"--no-ff",
				"-m",
				"Merge pull request #99 from user/some-branch",
			]);

			// Back on feature — parentage should match because featureHead is second parent
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature", 50, featureHead);
			expect(result).not.toBeNull();
			expect(result?.subject).toContain("#99");
		});

		test("branch-name match is preferred over parentage match", async () => {
			const defaultBranch = (await getDefaultBranch(repoDir, "origin")) ?? "main";

			// Create feature branch with a commit
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "feature.txt"), "feature content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "feature.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "feature commit"]);
			const featureHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

			// Merge with subject that DOES contain "feature"
			Bun.spawnSync(["git", "-C", repoDir, "checkout", defaultBranch]);
			Bun.spawnSync([
				"git",
				"-C",
				repoDir,
				"merge",
				"feature",
				"--no-ff",
				"-m",
				"Merge pull request #42 from user/feature",
			]);

			// Both strategies would match — branch-name should win
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "feature"]);
			const result = await findMergeCommitForBranch(repoDir, defaultBranch, "feature", 50, featureHead);
			expect(result).not.toBeNull();
			expect(result?.subject).toContain("feature");
			expect(result?.subject).toContain("#42");
		});
	});

	describe("findTicketReferencedCommit", () => {
		test("finds commit with ticket in subject", async () => {
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: enable batching PROJ-208 (#76)"]);

			const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
			expect(result).not.toBeNull();
			expect(result?.subject).toContain("PROJ-208");
		});

		test("finds commit with ticket in body (trailers)", async () => {
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: enable query batching (#76)\n\nReferences: PROJ-208"]);

			const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
			expect(result).not.toBeNull();
			expect(result?.subject).toContain("batching");
		});

		test("returns most recent match when multiple exist", async () => {
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content a");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "first PROJ-208 (#10)"]);

			writeFileSync(join(repoDir, "b.txt"), "content b");
			Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "second PROJ-208 (#20)"]);

			const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
			expect(result).not.toBeNull();
			// git log returns most recent first
			expect(result?.subject).toContain("second");
		});

		test("returns null when no ticket match", async () => {
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "unrelated commit (#99)"]);

			const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
			expect(result).toBeNull();
		});

		test("is case-insensitive", async () => {
			Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
			writeFileSync(join(repoDir, "a.txt"), "content");
			Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
			Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: something (#76)\n\nReferences: proj-208"]);

			const result = await findTicketReferencedCommit(repoDir, "PROJ-208");
			expect(result).not.toBeNull();
			expect(result?.subject).toContain("something");
		});
	});
});

describe("parseDiffShortstat", () => {
	test("parses full shortstat output", () => {
		const result = parseDiffShortstat(" 47 files changed, 320 insertions(+), 180 deletions(-)\n");
		expect(result).toEqual({ files: 47, insertions: 320, deletions: 180 });
	});

	test("parses insertions only", () => {
		const result = parseDiffShortstat(" 3 files changed, 50 insertions(+)\n");
		expect(result).toEqual({ files: 3, insertions: 50, deletions: 0 });
	});

	test("parses deletions only", () => {
		const result = parseDiffShortstat(" 1 file changed, 10 deletions(-)\n");
		expect(result).toEqual({ files: 1, insertions: 0, deletions: 10 });
	});

	test("parses singular form", () => {
		const result = parseDiffShortstat(" 1 file changed, 1 insertion(+), 1 deletion(-)\n");
		expect(result).toEqual({ files: 1, insertions: 1, deletions: 1 });
	});

	test("returns null for empty output", () => {
		expect(parseDiffShortstat("")).toBeNull();
		expect(parseDiffShortstat("\n")).toBeNull();
	});
});
