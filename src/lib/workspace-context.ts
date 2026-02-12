import { error } from "./output";
import type { ArbContext } from "./types";
import { workspaceBranch } from "./workspace-branch";

export function requireWorkspace(ctx: ArbContext): { wsDir: string; workspace: string } {
	if (!ctx.currentWorkspace) {
		error("Not inside a workspace. cd into one or use --workspace <workspace>");
		process.exit(1);
	}
	return { wsDir: `${ctx.baseDir}/${ctx.currentWorkspace}`, workspace: ctx.currentWorkspace };
}

export async function requireBranch(wsDir: string, workspaceName: string): Promise<string> {
	const wb = await workspaceBranch(wsDir);
	if (!wb) {
		error(`No branch configured for workspace ${workspaceName} and no worktrees to infer from`);
		process.exit(1);
	}
	return wb.branch;
}
