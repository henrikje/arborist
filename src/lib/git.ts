export async function git(
	repoDir: string,
	...args: string[]
): Promise<{ exitCode: number; stdout: string }> {
	const proc = Bun.spawn(["git", "-C", repoDir, ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return { exitCode: proc.exitCode ?? 1, stdout };
}

export async function getDefaultBranch(repoDir: string): Promise<string | null> {
	// Try origin/HEAD first
	const symRef = await git(repoDir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
	if (symRef.exitCode === 0) {
		return symRef.stdout.trim().replace(/^origin\//, "");
	}
	// No origin — use the repo's own HEAD branch
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

export async function remoteBranchExists(repoDir: string, branch: string): Promise<boolean> {
	const result = await git(repoDir, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`);
	return result.exitCode === 0;
}

export async function isRepoDirty(repoDir: string): Promise<boolean> {
	const result = await git(repoDir, "status", "--porcelain");
	return result.exitCode !== 0 || !!result.stdout.trim();
}

export async function parseGitStatus(
	repoDir: string,
): Promise<{ staged: number; modified: number; untracked: number }> {
	const result = await git(repoDir, "status", "--porcelain");
	if (result.exitCode !== 0) return { staged: 0, modified: 0, untracked: 0 };
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.reduce(
			(acc, line) => {
				const x = line[0];
				const y = line[1];
				if (x === "?") acc.untracked++;
				else {
					if (x !== " " && x !== "?") acc.staged++;
					if (y !== " " && y !== "?") acc.modified++;
				}
				return acc;
			},
			{ staged: 0, modified: 0, untracked: 0 },
		);
}
