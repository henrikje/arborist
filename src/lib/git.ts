import { existsSync } from "node:fs";

export type GitOperation = "rebase" | "merge" | "cherry-pick" | null;

export async function detectOperation(repoDir: string): Promise<GitOperation> {
	const gitDirResult = await git(repoDir, "rev-parse", "--git-dir");
	if (gitDirResult.exitCode !== 0) return null;
	const gitDir = gitDirResult.stdout.trim();
	const absGitDir = gitDir.startsWith("/") ? gitDir : `${repoDir}/${gitDir}`;
	if (existsSync(`${absGitDir}/rebase-merge`) || existsSync(`${absGitDir}/rebase-apply`)) return "rebase";
	if (existsSync(`${absGitDir}/MERGE_HEAD`)) return "merge";
	if (existsSync(`${absGitDir}/CHERRY_PICK_HEAD`)) return "cherry-pick";
	return null;
}

export async function git(repoDir: string, ...args: string[]): Promise<{ exitCode: number; stdout: string }> {
	const proc = Bun.spawn(["git", "-C", repoDir, ...args], {
		cwd: repoDir,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return { exitCode: proc.exitCode ?? 1, stdout };
}

export async function getDefaultBranch(repoDir: string, remote = "origin"): Promise<string | null> {
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

export async function hasRemote(repoDir: string): Promise<boolean> {
	const result = await git(repoDir, "remote");
	return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export function validateBranchName(name: string): boolean {
	const result = Bun.spawnSync(["git", "check-ref-format", "--branch", name]);
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

export async function remoteBranchExists(repoDir: string, branch: string, remote = "origin"): Promise<boolean> {
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
