import { existsSync } from "node:fs";
import { ArbError } from "./errors";
import { error } from "./output";
import type { ArbContext } from "./types";
import { workspaceBranch } from "./workspace-branch";

export function requireWorkspace(ctx: ArbContext): { wsDir: string; workspace: string } {
	if (!ctx.currentWorkspace) {
		error("Not inside a workspace. cd into one or use -C <workspace>");
		throw new ArbError("Not inside a workspace. cd into one or use -C <workspace>");
	}
	const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;
	if (!existsSync(`${wsDir}/.arbws`)) {
		error(`Workspace '${ctx.currentWorkspace}' does not exist`);
		throw new ArbError(`Workspace '${ctx.currentWorkspace}' does not exist`);
	}
	return { wsDir, workspace: ctx.currentWorkspace };
}

export async function requireBranch(wsDir: string, workspaceName: string): Promise<string> {
	const wb = await workspaceBranch(wsDir);
	if (!wb) {
		error(`No branch configured for workspace ${workspaceName} and no repos to infer from`);
		throw new ArbError(`No branch configured for workspace ${workspaceName} and no repos to infer from`);
	}
	return wb.branch;
}
