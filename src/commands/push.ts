import { basename } from "node:path";
import type { Command } from "commander";
import { checkBranchMatch, hasRemote } from "../lib/git";
import { error, info, warn } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export function registerPushCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("push")
		.summary("Push the feature branch to origin")
		.description(
			"Push the feature branch to origin for every repo in the workspace. Skips repos without a remote and repos where the branch hasn't been set up for tracking yet.",
		)
		.action(async () => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);
			const branch = await requireBranch(wsDir, workspace);

			const pushOk: string[] = [];
			const pushFailed: string[] = [];

			for (const repoDir of workspaceRepoDirs(wsDir)) {
				const repo = basename(repoDir);

				// Skip local repos
				if (!(await hasRemote(`${ctx.reposDir}/${repo}`))) {
					warn(`  [${repo}] local repo — skipping`);
					continue;
				}

				// Check branch match
				const bm = await checkBranchMatch(repoDir, branch);
				if (!bm.matches) {
					warn(`  [${repo}] on branch ${bm.actual}, expected ${branch} — skipping`);
					continue;
				}

				// Check upstream
				const upstream = await Bun.$`git -C ${repoDir} config branch.${branch}.remote`.quiet().nothrow();
				if (upstream.exitCode !== 0 || !upstream.text().trim()) {
					warn(`  [${repo}] no upstream set — run: git push -u origin ${branch}`);
					continue;
				}

				process.stderr.write(`  [${repo}] pushing ${branch}... `);
				const pushResult = await Bun.$`git -C ${repoDir} push origin ${branch}`.quiet().nothrow();
				if (pushResult.exitCode === 0) {
					info("ok");
					pushOk.push(repo);
				} else {
					error("failed");
					pushFailed.push(repo);
				}
			}

			if (pushFailed.length === 0) {
				info(`Pushed ${pushOk.length} repo(s)`);
			} else {
				error(`Failed: ${pushFailed.join(" ")}`);
			}

			if (pushFailed.length > 0) process.exit(1);
		});
}
