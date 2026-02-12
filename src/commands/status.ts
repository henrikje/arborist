import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { branchExistsLocally, getDefaultBranch, hasRemote, parseGitStatus, remoteBranchExists } from "../lib/git";
import { dim, green, red, yellow } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";
import { requireWorkspace } from "../lib/workspace-context";

export function registerStatusCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("status")
		.option("-d, --dirty", "Only show dirty repos")
		.description("Show worktree status")
		.action(async (options: { dirty?: boolean }) => {
			const ctx = getCtx();
			requireWorkspace(ctx);
			await runStatus(ctx, options.dirty ?? false);
		});
}

export async function runStatus(ctx: ArbContext, dirtyOnly: boolean): Promise<void> {
	const wsDir = `${ctx.baseDir}/${ctx.currentWorkspace}`;

	// Read expected branch from config
	let configBranch: string | null = null;
	const wb = await workspaceBranch(wsDir);
	if (wb) configBranch = wb.branch;
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");
	const repoDirs = workspaceRepoDirs(wsDir);
	let found = false;

	for (const repoDir of repoDirs) {
		const repo = basename(repoDir);
		const repoPath = `${ctx.reposDir}/${repo}`;

		// Branch name
		const branchResult = await Bun.$`git -C ${repoDir} branch --show-current`.quiet().nothrow();
		const branch = branchResult.exitCode === 0 ? branchResult.text().trim() : "?";

		// Base branch: workspace config takes priority if it exists in this repo
		const repoHasRemote = await hasRemote(repoPath);
		let defaultBranch: string | null = null;
		if (configBase) {
			const baseExists = repoHasRemote
				? await remoteBranchExists(repoPath, configBase)
				: await branchExistsLocally(repoPath, configBase);
			if (baseExists) {
				defaultBranch = configBase;
			}
		}
		if (!defaultBranch) {
			defaultBranch = await getDefaultBranch(repoPath);
		}

		// Ahead/behind default branch
		let mainAhead = 0;
		let mainBehind = 0;
		if (defaultBranch) {
			const compareRef = repoHasRemote ? `origin/${defaultBranch}` : defaultBranch;
			const lr = await Bun.$`git -C ${repoDir} rev-list --left-right --count ${compareRef}...HEAD`.quiet().nothrow();
			if (lr.exitCode === 0) {
				const parts = lr.text().trim().split(/\s+/);
				mainBehind = Number.parseInt(parts[0] ?? "0", 10);
				mainAhead = Number.parseInt(parts[1] ?? "0", 10);
			}
		}

		// Push status vs origin/<branch>
		let pushStatus: string;
		if (!repoHasRemote) {
			pushStatus = dim("local");
		} else if (await remoteBranchExists(repoDir, branch)) {
			const pushLr = await Bun.$`git -C ${repoDir} rev-list --left-right --count origin/${branch}...HEAD`
				.quiet()
				.nothrow();
			let pushAhead = 0;
			let pushBehind = 0;
			if (pushLr.exitCode === 0) {
				const parts = pushLr.text().trim().split(/\s+/);
				pushBehind = Number.parseInt(parts[0] ?? "0", 10);
				pushAhead = Number.parseInt(parts[1] ?? "0", 10);
			}
			if (pushAhead === 0 && pushBehind === 0) {
				pushStatus = green("in sync");
			} else {
				pushStatus = yellow(
					[pushAhead > 0 && `${pushAhead} to push`, pushBehind > 0 && `${pushBehind} to pull`]
						.filter(Boolean)
						.join(", "),
				);
			}
		} else {
			pushStatus = yellow("not pushed");
		}

		// Parse porcelain status
		const { staged, modified, untracked } = await parseGitStatus(repoDir);

		if (dirtyOnly && staged === 0 && modified === 0 && untracked === 0) {
			continue;
		}

		found = true;

		// Build output
		let out = `  ${repo.padEnd(20)} `;

		// vs origin/<default>
		if (defaultBranch) {
			const mainParts = [mainAhead > 0 && green(`${mainAhead} ahead`), mainBehind > 0 && red(`${mainBehind} behind`)]
				.filter(Boolean)
				.join(" ");
			out += mainParts ? `${defaultBranch}: ${mainParts}  ` : `${defaultBranch}: ${green("even")}  `;
		}

		// vs origin/<branch>
		out += `remote: ${pushStatus}`;

		// Working tree details
		const wtParts = [
			staged > 0 && green(`${staged} staged`),
			modified > 0 && yellow(`${modified} modified`),
			untracked > 0 && yellow(`${untracked} untracked`),
		]
			.filter(Boolean)
			.join(", ");
		if (wtParts) {
			out += `  local: ${wtParts}`;
		}

		// Branch drift warning
		if (configBranch && branch !== configBranch) {
			out += `  ${red(`on branch ${branch}, expected ${configBranch}`)}`;
		}

		process.stdout.write(`${out}\n`);
	}

	if (!found) {
		process.stdout.write("  (no repos)\n");
	}
}
