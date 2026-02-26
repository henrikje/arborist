import { existsSync } from "node:fs";
import { basename } from "node:path";
import { configGet } from "./config";
import { git } from "./git";
import { warn } from "./output";
import { workspaceRepoDirs } from "./repos";

export interface WorkspaceBranchResult {
	branch: string;
	inferred: boolean;
}

export async function workspaceBranch(wsDir: string): Promise<WorkspaceBranchResult | null> {
	const configFile = `${wsDir}/.arbws/config`;

	if (existsSync(configFile)) {
		const branch = configGet(configFile, "branch");
		if (branch) {
			return { branch, inferred: false };
		}
	}

	// Config missing or empty — try to infer from first worktree
	const repoDirs = workspaceRepoDirs(wsDir);
	const firstRepoDir = repoDirs[0];
	if (firstRepoDir) {
		const result = await git(firstRepoDir, "branch", "--show-current");
		if (result.exitCode === 0) {
			const branch = result.stdout.trim();
			if (branch) {
				const wsName = basename(wsDir);
				warn(`Config missing for ${wsName}, inferred branch '${branch}' from repo`);
				return { branch, inferred: true };
			}
		}
	}

	return null;
}
