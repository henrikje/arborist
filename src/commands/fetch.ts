import type { Command } from "commander";
import { error, info, warn } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { classifyRepos } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerFetchCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("fetch")
		.summary("Fetch all repos from origin")
		.description(
			"Fetch from origin for every repo in the workspace, in parallel. Nothing is merged — use this to see what's changed before deciding what to do.",
		)
		.action(async () => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);
			const { repos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);

			if (fetchDirs.length === 0 && localRepos.length === 0) {
				return;
			}

			for (const repo of localRepos) {
				warn(`  [${repo}] local repo — skipping`);
			}

			let results = new Map<string, { exitCode: number; output: string }>();
			if (fetchDirs.length > 0) {
				process.stderr.write(`Fetching ${fetchDirs.length} repo(s)...\n`);
				results = await parallelFetch(fetchDirs);
			}

			// Report results
			const fetchFailed = reportFetchFailures(repos, localRepos, results);
			const fetchOk = repos
				.filter((repo) => !localRepos.includes(repo) && !fetchFailed.includes(repo))
				.filter((repo) => {
					const fr = results.get(repo);
					if (!fr) return false;
					const firstLine = fr.output.split("\n")[0]?.trim();
					process.stderr.write(`  [${repo}] ${firstLine || "up to date"}\n`);
					return true;
				});

			if (fetchFailed.length === 0) {
				info(`Fetched ${fetchOk.length} repo(s)`);
			} else {
				error(`Failed: ${fetchFailed.join(" ")}`);
			}

			if (fetchFailed.length > 0) process.exit(1);
		});
}
