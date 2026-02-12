import type { Command } from "commander";
import { checkBranchMatch, remoteBranchExists } from "../lib/git";
import { error, hint, info, warn } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { classifyRepos } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export function registerPullCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("pull")
		.description("Pull the feature branch from origin")
		.action(async () => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);
			const branch = await requireBranch(wsDir, workspace);

			// Phase 1: parallel fetch
			const { repos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);

			let fetchResults = new Map<string, { exitCode: number; output: string }>();
			if (fetchDirs.length > 0) {
				process.stderr.write(`Fetching ${fetchDirs.length} repo(s)...\n`);
				fetchResults = await parallelFetch(fetchDirs);
			}

			// Report fetch failures
			const fetchFailed = reportFetchFailures(repos, localRepos, fetchResults);

			// Phase 2: sequential git pull
			process.stderr.write(`Pulling ${repos.length} repo(s)...\n`);
			const pullOk: string[] = [];
			const pullFailed: string[] = [];

			for (const repo of repos) {
				const repoDir = `${wsDir}/${repo}`;

				// Skip local repos
				if (localRepos.includes(repo)) {
					warn(`  [${repo}] local repo — skipping`);
					continue;
				}

				// Skip repos that failed to fetch
				if (fetchFailed.includes(repo)) {
					pullFailed.push(repo);
					continue;
				}

				// Check branch match
				const bm = await checkBranchMatch(repoDir, branch);
				if (!bm.matches) {
					error(`  [${repo}] on branch ${bm.actual}, expected ${branch} — skipping`);
					continue;
				}

				// Check if origin/<branch> exists
				if (!(await remoteBranchExists(repoDir, branch))) {
					warn(`  [${repo}] not pushed yet — skipping`);
					continue;
				}

				process.stderr.write(`  [${repo}] pulling ${branch}... `);
				const pullResult = await Bun.$`git -C ${repoDir} pull`.quiet().nothrow();
				if (pullResult.exitCode === 0) {
					info("ok");
					pullOk.push(repo);
				} else {
					error("failed");
					pullFailed.push(repo);
				}
			}

			if (pullFailed.length === 0) {
				info(`Pulled ${pullOk.length} repo(s)`);
			} else {
				error(`Failed: ${pullFailed.join(" ")}`);
				for (const repo of pullFailed) {
					hint(`cd ${wsDir}/${repo}`);
				}
			}
			hint("Check workspace status:  arb status");

			if (pullFailed.length > 0) process.exit(1);
		});
}
