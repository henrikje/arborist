import { existsSync, statSync } from "node:fs";
import { debugGit, isDebug } from "./debug";

export type GitOperation = "rebase" | "merge" | "cherry-pick" | "revert" | "bisect" | "am" | null;

export async function detectOperation(repoDir: string): Promise<GitOperation> {
	const gitDirResult = await git(repoDir, "rev-parse", "--git-dir");
	if (gitDirResult.exitCode !== 0) return null;
	const gitDir = gitDirResult.stdout.trim();
	const absGitDir = gitDir.startsWith("/") ? gitDir : `${repoDir}/${gitDir}`;
	if (existsSync(`${absGitDir}/rebase-merge`)) return "rebase";
	if (existsSync(`${absGitDir}/rebase-apply`)) {
		// Distinguish am (git am) from rebase: am sets an "applying" sentinel
		if (existsSync(`${absGitDir}/rebase-apply/applying`)) return "am";
		return "rebase";
	}
	if (existsSync(`${absGitDir}/MERGE_HEAD`)) return "merge";
	if (existsSync(`${absGitDir}/CHERRY_PICK_HEAD`)) return "cherry-pick";
	if (existsSync(`${absGitDir}/REVERT_HEAD`)) return "revert";
	if (existsSync(`${absGitDir}/BISECT_LOG`)) return "bisect";
	return null;
}

export async function isShallowRepo(repoDir: string): Promise<boolean> {
	const result = await git(repoDir, "rev-parse", "--is-shallow-repository");
	return result.exitCode === 0 && result.stdout.trim() === "true";
}

export function isLinkedWorktree(repoDir: string): boolean {
	try {
		const stat = statSync(`${repoDir}/.git`);
		// Linked worktrees have a .git file (not directory) pointing to the main repo's worktrees dir
		return !stat.isDirectory();
	} catch {
		// .git doesn't exist — not a valid git repo at all
		return false;
	}
}

export async function git(
	repoDir: string,
	...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const start = isDebug() ? performance.now() : 0;
	const proc = Bun.spawn(["git", "-C", repoDir, ...args], {
		cwd: repoDir,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	await proc.exited;
	const exitCode = proc.exitCode ?? 1;
	if (isDebug()) {
		debugGit(`git -C ${repoDir} ${args.join(" ")}`, performance.now() - start, exitCode);
	}
	return { exitCode, stdout, stderr };
}

export async function getShortHead(repoDir: string): Promise<string> {
	const result = await git(repoDir, "rev-parse", "--short", "HEAD");
	return result.exitCode === 0 ? result.stdout.trim() : "";
}

export async function getMergeBase(repoDir: string, ref1: string, ref2: string): Promise<string | null> {
	const result = await git(repoDir, "merge-base", ref1, ref2);
	if (result.exitCode !== 0) return null;
	const full = result.stdout.trim();
	if (!full) return null;
	const short = await git(repoDir, "rev-parse", "--short", full);
	return short.exitCode === 0 ? short.stdout.trim() : full.slice(0, 7);
}

export async function getDefaultBranch(repoDir: string, remote: string): Promise<string | null> {
	// Try remote HEAD first
	const symRef = await git(repoDir, "symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`);
	if (symRef.exitCode === 0) {
		return symRef.stdout.trim().replace(new RegExp(`^${remote}/`), "");
	}
	// No remote HEAD — use the repo's own HEAD branch
	const headRef = await git(repoDir, "symbolic-ref", "--short", "HEAD");
	if (headRef.exitCode === 0) {
		return headRef.stdout.trim();
	}
	return null;
}

export function validateBranchName(name: string): boolean {
	const start = isDebug() ? performance.now() : 0;
	const result = Bun.spawnSync(["git", "check-ref-format", "--branch", name]);
	if (isDebug()) {
		debugGit(`git check-ref-format --branch ${name}`, performance.now() - start, result.exitCode);
	}
	return result.exitCode === 0;
}

export function validateWorkspaceName(name: string): string | null {
	if (name.startsWith(".")) {
		return `Invalid workspace name '${name}': must not start with '.'`;
	}
	if (name.includes("/")) {
		return `Invalid workspace name '${name}': must not contain '/'`;
	}
	if (name.includes("..")) {
		return `Invalid workspace name '${name}': must not contain '..'`;
	}
	if (/\s/.test(name)) {
		return `Invalid workspace name '${name}': must not contain whitespace`;
	}
	return null;
}

export async function checkBranchMatch(
	repoDir: string,
	expected: string,
): Promise<{ matches: boolean; actual: string }> {
	const result = await git(repoDir, "branch", "--show-current");
	const actual = result.exitCode === 0 ? result.stdout.trim() : "?";
	return { matches: actual === expected, actual };
}

export async function branchExistsLocally(repoDir: string, branch: string): Promise<boolean> {
	const result = await git(repoDir, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
	return result.exitCode === 0;
}

export async function remoteBranchExists(repoDir: string, branch: string, remote: string): Promise<boolean> {
	const result = await git(repoDir, "show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`);
	return result.exitCode === 0;
}

export async function isRepoDirty(repoDir: string): Promise<boolean> {
	const result = await git(repoDir, "status", "--porcelain");
	return result.exitCode !== 0 || !!result.stdout.trim();
}

export async function parseGitStatus(
	repoDir: string,
): Promise<{ staged: number; modified: number; untracked: number; conflicts: number }> {
	const result = await git(repoDir, "status", "--porcelain");
	if (result.exitCode !== 0) return { staged: 0, modified: 0, untracked: 0, conflicts: 0 };
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.reduce(
			(acc, line) => {
				const x = line[0];
				const y = line[1];
				if (x === "?") acc.untracked++;
				else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
					acc.conflicts++;
				} else {
					if (x !== " " && x !== "?") acc.staged++;
					if (y !== " " && y !== "?") acc.modified++;
				}
				return acc;
			},
			{ staged: 0, modified: 0, untracked: 0, conflicts: 0 },
		);
}

export interface FileChange {
	file: string;
	type: "new file" | "modified" | "deleted" | "renamed" | "copied";
}

function stagedType(code: string): FileChange["type"] {
	switch (code) {
		case "A":
			return "new file";
		case "M":
			return "modified";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		default:
			return "modified";
	}
}

function unstagedType(code: string): FileChange["type"] {
	switch (code) {
		case "D":
			return "deleted";
		default:
			return "modified";
	}
}

export async function parseGitStatusFiles(
	repoDir: string,
): Promise<{ staged: FileChange[]; unstaged: FileChange[]; untracked: string[] }> {
	const result = await git(repoDir, "status", "--porcelain");
	const staged: FileChange[] = [];
	const unstaged: FileChange[] = [];
	const untracked: string[] = [];
	if (result.exitCode !== 0) return { staged, unstaged, untracked };
	for (const line of result.stdout.split("\n").filter(Boolean)) {
		const x = line[0];
		const y = line[1];
		const file = line.slice(3);
		if (x === "?") {
			untracked.push(file);
		} else {
			if (x && x !== " " && x !== "?") staged.push({ file, type: stagedType(x) });
			if (y && y !== " " && y !== "?") unstaged.push({ file, type: unstagedType(y) });
		}
	}
	return { staged, unstaged, untracked };
}

export async function getHeadCommitDate(repoDir: string): Promise<string | null> {
	const result = await git(repoDir, "log", "-1", "--format=%aI", "HEAD");
	if (result.exitCode !== 0) return null;
	const date = result.stdout.trim();
	return date || null;
}

export async function predictMergeConflict(
	repoDir: string,
	ref: string,
): Promise<{ hasConflict: boolean; files: string[] } | null> {
	const result = await git(repoDir, "merge-tree", "--write-tree", "--name-only", "HEAD", ref);
	if (result.exitCode === 0) return { hasConflict: false, files: [] };
	if (result.exitCode === 1) {
		// Exit 1 with stdout = conflict detected (stdout has tree hash + file list)
		// Exit 1 without stdout = error (e.g. invalid ref — error goes to stderr)
		if (!result.stdout.trim()) return null;
		// Skip first line (tree hash), filter CONFLICT/Auto-merging info lines
		const files = result.stdout
			.split("\n")
			.slice(1)
			.filter((line) => line && !line.startsWith("Auto-merging") && !line.startsWith("CONFLICT"));
		return { hasConflict: true, files };
	}
	return null; // unexpected error or old git without merge-tree support
}

export async function getCommitsBetween(
	repoDir: string,
	ref1: string,
	ref2: string,
): Promise<{ hash: string; subject: string }[]> {
	const result = await git(repoDir, "log", "--oneline", `${ref1}..${ref2}`);
	if (result.exitCode !== 0) return [];
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const spaceIdx = line.indexOf(" ");
			return {
				hash: line.slice(0, spaceIdx),
				subject: line.slice(spaceIdx + 1),
			};
		});
}

export async function getCommitsBetweenFull(
	repoDir: string,
	ref1: string,
	ref2: string,
): Promise<{ shortHash: string; fullHash: string; subject: string }[]> {
	const result = await git(repoDir, "log", "--format=%h %H %s", `${ref1}..${ref2}`);
	if (result.exitCode !== 0) return [];
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const first = line.indexOf(" ");
			const second = line.indexOf(" ", first + 1);
			return {
				shortHash: line.slice(0, first),
				fullHash: line.slice(first + 1, second),
				subject: line.slice(second + 1),
			};
		});
}

export function parseGitNumstat(output: string): { file: string; insertions: number; deletions: number }[] {
	return output
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const parts = line.split("\t");
			if (parts.length < 3) return null;
			const [ins, del, ...fileParts] = parts;
			const file = fileParts.join("\t"); // Handle filenames with tabs (renames show as "old => new")
			// Binary files show as "-\t-\tfile"
			return {
				file: file ?? "",
				insertions: ins === "-" ? 0 : Number.parseInt(ins ?? "0", 10),
				deletions: del === "-" ? 0 : Number.parseInt(del ?? "0", 10),
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export async function detectBranchMerged(
	repoDir: string,
	baseBranchRef: string,
	commitLimit = 200,
	branchRef = "HEAD",
): Promise<"merge" | "squash" | null> {
	// Phase 1: Ancestor check (instant) — detects merge commits and fast-forwards
	const ancestor = await git(repoDir, "merge-base", "--is-ancestor", branchRef, baseBranchRef);
	if (ancestor.exitCode === 0) return "merge";

	// Phase 2: Squash check — cumulative patch-id comparison
	const mergeBaseResult = await git(repoDir, "merge-base", branchRef, baseBranchRef);
	if (mergeBaseResult.exitCode !== 0) return null;
	const mergeBase = mergeBaseResult.stdout.trim();
	if (!mergeBase) return null;

	// Cumulative patch-id for the entire branch range
	const cumulativeStart = isDebug() ? performance.now() : 0;
	const cumulativeResult = await Bun.$`git -C ${repoDir} diff ${mergeBase}..${branchRef} | git patch-id --stable`
		.quiet()
		.nothrow();
	if (isDebug()) {
		debugGit(
			`git -C ${repoDir} diff ${mergeBase}..${branchRef} | git patch-id --stable`,
			performance.now() - cumulativeStart,
			cumulativeResult.exitCode,
		);
	}
	if (cumulativeResult.exitCode !== 0) return null;
	const cumulativeLine = cumulativeResult.text().trim();
	if (!cumulativeLine) return null;
	const cumulativePatchId = cumulativeLine.split(" ")[0];
	if (!cumulativePatchId) return null;

	// Per-commit patch-ids for recent base commits
	const perCommitStart = isDebug() ? performance.now() : 0;
	const perCommitResult =
		await Bun.$`git -C ${repoDir} log -p --max-count=${commitLimit} ${mergeBase}..${baseBranchRef} | git patch-id --stable`
			.quiet()
			.nothrow();
	if (isDebug()) {
		debugGit(
			`git -C ${repoDir} log -p --max-count=${commitLimit} ${mergeBase}..${baseBranchRef} | git patch-id --stable`,
			performance.now() - perCommitStart,
			perCommitResult.exitCode,
		);
	}
	if (perCommitResult.exitCode !== 0) return null;

	for (const line of perCommitResult.text().split("\n")) {
		const patchId = line.split(" ")[0];
		if (patchId === cumulativePatchId) return "squash";
	}

	return null;
}

export async function predictStashPopConflict(repoDir: string, ref: string): Promise<{ overlapping: string[] }> {
	// Get dirty file paths (unstaged + staged)
	const [unstaged, staged] = await Promise.all([
		git(repoDir, "diff", "--name-only"),
		git(repoDir, "diff", "--name-only", "--cached"),
	]);
	const dirtyFiles = new Set<string>();
	for (const line of unstaged.stdout.split("\n").filter(Boolean)) dirtyFiles.add(line);
	for (const line of staged.stdout.split("\n").filter(Boolean)) dirtyFiles.add(line);

	if (dirtyFiles.size === 0) return { overlapping: [] };

	// Get incoming change paths (three-dot diff)
	const incoming = await git(repoDir, "diff", "--name-only", `HEAD...${ref}`);
	const incomingFiles = new Set<string>();
	if (incoming.exitCode === 0) {
		for (const line of incoming.stdout.split("\n").filter(Boolean)) incomingFiles.add(line);
	}

	const overlapping = [...dirtyFiles].filter((f) => incomingFiles.has(f));
	return { overlapping };
}

export interface CommitMatchResult {
	rebaseMatches: Map<string, string>; // incomingHash → localHash
	squashMatch: { incomingHash: string; localHashes: string[] } | null;
}

export async function matchDivergedCommits(repoDir: string, baseRef: string): Promise<CommitMatchResult> {
	const result: CommitMatchResult = { rebaseMatches: new Map(), squashMatch: null };

	// Phase 1: 1:1 rebase matching (same algorithm as detectRebasedCommits)
	const matchStart = isDebug() ? performance.now() : 0;
	const [localResult, incomingResult] = await Promise.all([
		Bun.$`git -C ${repoDir} log -p ${baseRef}..HEAD | git patch-id --stable`.quiet().nothrow(),
		Bun.$`git -C ${repoDir} log -p HEAD..${baseRef} | git patch-id --stable`.quiet().nothrow(),
	]);
	if (isDebug()) {
		const elapsed = performance.now() - matchStart;
		debugGit(`git -C ${repoDir} log -p ${baseRef}..HEAD | git patch-id --stable`, elapsed, localResult.exitCode);
		debugGit(`git -C ${repoDir} log -p HEAD..${baseRef} | git patch-id --stable`, elapsed, incomingResult.exitCode);
	}

	if (localResult.exitCode !== 0 || incomingResult.exitCode !== 0) return result;

	const parse = (text: string) => {
		const map = new Map<string, string>(); // patchId → commitHash
		for (const line of text.split("\n")) {
			const [patchId, hash] = line.split(" ");
			if (patchId && hash) map.set(patchId, hash);
		}
		return map;
	};

	const localMap = parse(localResult.text()); // patchId → localHash
	const incomingMap = parse(incomingResult.text()); // patchId → incomingHash

	const localPatchIds = new Set(localMap.keys());
	for (const [patchId, incomingHash] of incomingMap) {
		if (localPatchIds.has(patchId)) {
			const localHash = localMap.get(patchId);
			if (localHash) result.rebaseMatches.set(incomingHash, localHash);
		}
	}

	// Phase 2: Full-range squash detection (only when local has > 1 commit and unmatched incoming exist)
	const localCommitCount = localMap.size;
	const unmatchedIncoming = [...incomingMap.entries()].filter(([, hash]) => !result.rebaseMatches.has(hash));

	if (localCommitCount > 1 && unmatchedIncoming.length > 0) {
		const mergeBaseResult = await git(repoDir, "merge-base", "HEAD", baseRef);
		if (mergeBaseResult.exitCode === 0) {
			const mergeBase = mergeBaseResult.stdout.trim();
			if (mergeBase) {
				const squashStart = isDebug() ? performance.now() : 0;
				const cumulativeResult = await Bun.$`git -C ${repoDir} diff ${mergeBase}..HEAD | git patch-id --stable`
					.quiet()
					.nothrow();
				if (isDebug()) {
					debugGit(
						`git -C ${repoDir} diff ${mergeBase}..HEAD | git patch-id --stable`,
						performance.now() - squashStart,
						cumulativeResult.exitCode,
					);
				}
				if (cumulativeResult.exitCode === 0) {
					const cumulativeLine = cumulativeResult.text().trim();
					const cumulativePatchId = cumulativeLine.split(" ")[0];
					if (cumulativePatchId) {
						for (const [patchId, incomingHash] of unmatchedIncoming) {
							if (patchId === cumulativePatchId) {
								const allLocalHashes = [...localMap.values()];
								result.squashMatch = { incomingHash, localHashes: allLocalHashes };
								break;
							}
						}
					}
				}
			}
		}
	}

	return result;
}

export async function detectRebasedCommits(
	repoDir: string,
	trackingRef: string,
): Promise<{ count: number; rebasedLocalHashes: Set<string> } | null> {
	const rebaseStart = isDebug() ? performance.now() : 0;
	const [localResult, remoteResult] = await Promise.all([
		Bun.$`git -C ${repoDir} log -p ${trackingRef}..HEAD | git patch-id --stable`.quiet().nothrow(),
		Bun.$`git -C ${repoDir} log -p HEAD..${trackingRef} | git patch-id --stable`.quiet().nothrow(),
	]);
	if (isDebug()) {
		const elapsed = performance.now() - rebaseStart;
		debugGit(`git -C ${repoDir} log -p ${trackingRef}..HEAD | git patch-id --stable`, elapsed, localResult.exitCode);
		debugGit(`git -C ${repoDir} log -p HEAD..${trackingRef} | git patch-id --stable`, elapsed, remoteResult.exitCode);
	}

	if (localResult.exitCode !== 0 || remoteResult.exitCode !== 0) return null;

	const parse = (text: string) => {
		const map = new Map<string, string>(); // patchId → commitHash
		for (const line of text.split("\n")) {
			const [patchId, hash] = line.split(" ");
			if (patchId && hash) map.set(patchId, hash);
		}
		return map;
	};

	const localMap = parse(localResult.text());
	const remoteIds = new Set(parse(remoteResult.text()).keys());

	const rebasedLocalHashes = new Set<string>();
	for (const [patchId, hash] of localMap) {
		if (remoteIds.has(patchId)) rebasedLocalHashes.add(hash);
	}
	return { count: rebasedLocalHashes.size, rebasedLocalHashes };
}

export async function getDiffShortstat(
	repoDir: string,
	ref1: string,
	ref2: string,
): Promise<{ files: number; insertions: number; deletions: number } | null> {
	const result = await git(repoDir, "diff", "--shortstat", `${ref1}...${ref2}`);
	if (result.exitCode !== 0) return null;
	return parseDiffShortstat(result.stdout);
}

export async function predictRebaseConflictCommits(
	repoDir: string,
	targetRef: string,
): Promise<{ shortHash: string; files: string[] }[]> {
	// List incoming commits (commits on targetRef not on HEAD), in chronological order
	const logResult = await git(repoDir, "log", "--format=%H %h", "--reverse", `HEAD..${targetRef}`);
	if (logResult.exitCode !== 0) return [];
	const commits = logResult.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const spaceIdx = line.indexOf(" ");
			return { hash: line.slice(0, spaceIdx), shortHash: line.slice(spaceIdx + 1) };
		});
	if (commits.length === 0) return [];

	const conflicting: { shortHash: string; files: string[] }[] = [];
	for (const commit of commits) {
		// Simulate cherry-picking this commit onto HEAD by using merge-tree
		// merge-base is commit's parent, ours is HEAD, theirs is the commit
		const result = await git(
			repoDir,
			"merge-tree",
			"--write-tree",
			"--name-only",
			`--merge-base=${commit.hash}~1`,
			"HEAD",
			commit.hash,
		);
		if (result.exitCode === 1 && result.stdout.trim()) {
			// Conflict detected — parse file list (skip tree hash + info lines)
			const files = result.stdout
				.split("\n")
				.slice(1)
				.filter((line) => line && !line.startsWith("Auto-merging") && !line.startsWith("CONFLICT"));
			conflicting.push({ shortHash: commit.shortHash, files });
		}
		// exit 0 = clean, exit >1 = error (e.g. first commit has no parent) — skip
	}
	return conflicting;
}

export async function analyzeRetargetReplay(
	repoDir: string,
	oldBaseRef: string,
	newBaseRef: string,
): Promise<{ totalLocal: number; alreadyOnTarget: number; toReplay: number } | null> {
	const [localResult, newBaseResult] = await Promise.all([
		Bun.$`git -C ${repoDir} log -p ${oldBaseRef}..HEAD | git patch-id --stable`.quiet().nothrow(),
		Bun.$`git -C ${repoDir} log -p ${oldBaseRef}..${newBaseRef} | git patch-id --stable`.quiet().nothrow(),
	]);

	if (localResult.exitCode !== 0 || newBaseResult.exitCode !== 0) return null;

	const parse = (text: string) => {
		const map = new Map<string, string>();
		for (const line of text.split("\n")) {
			const [patchId, hash] = line.split(" ");
			if (patchId && hash) map.set(patchId, hash);
		}
		return map;
	};

	const localMap = parse(localResult.text());
	const newBaseIds = new Set(parse(newBaseResult.text()).keys());

	let alreadyOnTarget = 0;
	for (const patchId of localMap.keys()) {
		if (newBaseIds.has(patchId)) alreadyOnTarget++;
	}
	const totalLocal = localMap.size;
	return { totalLocal, alreadyOnTarget, toReplay: totalLocal - alreadyOnTarget };
}

export function parseDiffShortstat(output: string): { files: number; insertions: number; deletions: number } | null {
	const trimmed = output.trim();
	if (!trimmed) return null;
	const files = trimmed.match(/(\d+) files? changed/);
	const ins = trimmed.match(/(\d+) insertions?\(\+\)/);
	const del = trimmed.match(/(\d+) deletions?\(-\)/);
	if (!files) return null;
	return {
		files: Number.parseInt(files[1] ?? "0", 10),
		insertions: ins ? Number.parseInt(ins[1] ?? "0", 10) : 0,
		deletions: del ? Number.parseInt(del[1] ?? "0", 10) : 0,
	};
}
