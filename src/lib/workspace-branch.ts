import { existsSync } from "node:fs";
import { basename } from "node:path";
import { configGet } from "./config";
import { hint, warn } from "./output";
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
	if (repoDirs.length > 0) {
		const result = await Bun.$`git -C ${repoDirs[0]} branch --show-current`.quiet().nothrow();
		if (result.exitCode === 0) {
			const branch = result.text().trim();
			if (branch) {
				const wsName = basename(wsDir);
				warn(`Config missing for ${wsName}, inferred branch '${branch}' from worktree`);
				hint(`Repair config:  echo 'branch = ${branch}' > ${configFile}`);
				return { branch, inferred: true };
			}
		}
	}

	return null;
}
