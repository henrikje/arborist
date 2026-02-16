import type { Command } from "commander";
import { error, plural, success, warn } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
import { classifyRepos } from "../lib/repos";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

export function registerFetchCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("fetch")
		.summary("Fetch all repos from their remotes")
		.description(
			"Fetch from all configured remotes for every repo in the workspace, in parallel. Nothing is merged — use this to see what's changed before deciding what to do.",
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

			const remotesMap = await resolveRemotesMap(repos, ctx.reposDir);
			let results = new Map<string, { exitCode: number; output: string }>();
			if (fetchDirs.length > 0) {
				process.stderr.write(`Fetching ${plural(fetchDirs.length, "repo")}...\n`);
				results = await parallelFetch(fetchDirs, undefined, remotesMap);
			}

			// Report results
			const fetchFailed = reportFetchFailures(repos, localRepos, results);
			const fetchOk = repos.filter((repo) => !localRepos.includes(repo) && !fetchFailed.includes(repo));

			process.stderr.write("\n");
			for (const repo of fetchOk) {
				const fr = results.get(repo);
				if (!fr) continue;
				const refUpdates = fr.output.split("\n").filter((line) => line.includes("->")).length;
				if (refUpdates > 0) {
					process.stderr.write(`  [${repo}] ${plural(refUpdates, "ref")} updated\n`);
				} else {
					process.stderr.write(`  [${repo}] up to date\n`);
				}
			}

			if (fetchFailed.length === 0) {
				success(`Fetched ${plural(fetchOk.length, "repo")}`);
			} else {
				error(`Failed: ${fetchFailed.join(" ")}`);
			}

			if (fetchFailed.length > 0) process.exit(1);
		});
}
