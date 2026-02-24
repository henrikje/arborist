import { git } from "./git";

export interface RepoRemotes {
	base: string; // Source of base branches (rebase/merge targets, default branch)
	share: string; // Where feature branches are shared (push, pull, tracking)
}

/**
 * Resolve remote roles for a canonical repo.
 *
 * Resolution order:
 * 1. Single remote → use it for both roles
 * 2. Git config: remote.pushDefault → share; determine base from remaining remotes
 * 3. Convention: remote named "upstream" alongside "origin" → { base: "upstream", share: "origin" }
 * 4. Default: only "origin" → { base: "origin", share: "origin" }
 * 5. Ambiguous → error with guidance
 */
export async function resolveRemotes(repoDir: string, knownRemoteNames?: string[]): Promise<RepoRemotes> {
	const remotes = knownRemoteNames ?? (await getRemoteNames(repoDir));

	if (remotes.length === 0) {
		throw new Error(`No remotes configured for ${repoDir}`);
	}

	// Single remote — use it for both roles regardless of name
	if (remotes.length === 1) {
		const [single] = remotes as [string];
		return { base: single, share: single };
	}

	// Check remote.pushDefault
	const pushDefault = await getPushDefault(repoDir);
	if (pushDefault && remotes.includes(pushDefault)) {
		const others = remotes.filter((r) => r !== pushDefault);
		let baseRemote: string;
		if (others.length === 1) {
			[baseRemote] = others as [string];
		} else if (others.includes("upstream")) {
			baseRemote = "upstream";
		} else {
			const repoName = repoDir.split("/").pop() ?? repoDir;
			throw new Error(
				`Cannot determine base remote for ${repoName} (remotes: ${remotes.join(", ")}).\nAdd a remote named 'upstream' or reduce to two remotes.`,
			);
		}
		return { base: baseRemote, share: pushDefault };
	}

	// Convention: "upstream" + "origin"
	if (remotes.includes("upstream") && remotes.includes("origin")) {
		if (remotes.length === 2) {
			return { base: "upstream", share: "origin" };
		}
		// 3+ remotes with both upstream and origin but no pushDefault — ambiguous share
		const repoName = repoDir.split("/").pop() ?? repoDir;
		throw new Error(
			`Cannot determine remote roles for ${repoName} (remotes: ${remotes.join(", ")}).\nSet the share remote: git -C ${repoDir} config remote.pushDefault origin`,
		);
	}

	// Only "origin" — single-origin workflow
	if (remotes.includes("origin") && remotes.length === 2) {
		// Two remotes, one is origin, the other is not named "upstream" and no pushDefault
		// This is ambiguous
		const repoName = repoDir.split("/").pop() ?? repoDir;
		const other = remotes.find((r) => r !== "origin") ?? "origin";
		throw new Error(
			`Cannot determine remote roles for ${repoName} (remotes: ${remotes.join(", ")}).\nSet the share remote: git -C ${repoDir} config remote.pushDefault ${other}`,
		);
	}

	// Fallback: ambiguous
	const repoName = repoDir.split("/").pop() ?? repoDir;
	throw new Error(
		`Cannot determine remote roles for ${repoName} (remotes: ${remotes.join(", ")}).\nSet the share remote: git -C ${repoDir} config remote.pushDefault <remote-name>`,
	);
}

/** List all remote names for a repo. */
export async function getRemoteNames(repoDir: string): Promise<string[]> {
	const result = await git(repoDir, "remote");
	if (result.exitCode !== 0 || !result.stdout.trim()) {
		return [];
	}
	return result.stdout.trim().split("\n").filter(Boolean);
}

/** Get the URL of a named remote (for display in plan output). */
export async function getRemoteUrl(repoDir: string, remote: string): Promise<string | null> {
	const result = await git(repoDir, "remote", "get-url", remote);
	if (result.exitCode !== 0) return null;
	return result.stdout.trim() || null;
}

/** Read remote.pushDefault from git config. */
async function getPushDefault(repoDir: string): Promise<string | null> {
	const result = await git(repoDir, "config", "remote.pushDefault");
	if (result.exitCode !== 0) return null;
	return result.stdout.trim() || null;
}

/**
 * Resolve remotes for multiple repos in a workspace.
 * Returns a Map from repo name to RepoRemotes.
 * Errors propagate if any repo has no remotes or ambiguous remotes.
 */
export async function resolveRemotesMap(repos: string[], reposDir: string): Promise<Map<string, RepoRemotes>> {
	const remotesMap = new Map<string, RepoRemotes>();
	for (const repo of repos) {
		const remotes = await resolveRemotes(`${reposDir}/${repo}`);
		remotesMap.set(repo, remotes);
	}
	return remotesMap;
}
