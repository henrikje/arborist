import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { checkBranchMatch, git, remoteBranchExists } from "../lib/git";
import { error, info, inlineResult, inlineStart, red, success, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { type RepoRemotes, resolveRemotesMap } from "../lib/remotes";
import { classifyRepos, resolveRepoSelection } from "../lib/repos";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

interface PullAssessment {
	repo: string;
	repoDir: string;
	outcome: "will-pull" | "up-to-date" | "skip";
	skipReason?: string;
	behind: number;
	pullMode: "rebase" | "merge";
}

export function registerPullCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("pull [repos...]")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("--rebase", "Pull with rebase")
		.option("--merge", "Pull with merge")
		.summary("Pull the feature branch from the publish remote")
		.description(
			"Pull the feature branch for all repos, or only the named repos. Pulls from the publish remote (origin by default, or as configured for fork workflows). Fetches in parallel, then shows a plan and asks for confirmation before pulling. Repos that haven't been pushed yet are skipped.",
		)
		.action(async (repoArgs: string[], options: { rebase?: boolean; merge?: boolean; yes?: boolean }) => {
			if (options.rebase && options.merge) {
				error("Cannot use both --rebase and --merge");
				process.exit(1);
			}

			const flagMode: "rebase" | "merge" | undefined = options.rebase ? "rebase" : options.merge ? "merge" : undefined;
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);
			const branch = await requireBranch(wsDir, workspace);

			const selectedRepos = resolveRepoSelection(wsDir, repoArgs);
			const selectedSet = new Set(selectedRepos);
			const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);

			// Phase 1: parallel fetch (only selected repos)
			const { repos: allRepos, fetchDirs: allFetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
			const repos = allRepos.filter((r) => selectedSet.has(r));
			const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));

			let fetchResults = new Map<string, { exitCode: number; output: string }>();
			if (fetchDirs.length > 0) {
				process.stderr.write(`Fetching ${fetchDirs.length} repo(s)...\n`);
				fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
			}

			const fetchFailed = reportFetchFailures(repos, localRepos, fetchResults);

			// Phase 2: assess each repo
			const assessments: PullAssessment[] = [];
			for (const repo of repos) {
				const repoDir = `${wsDir}/${repo}`;
				assessments.push(
					await assessPullRepo(repo, repoDir, branch, localRepos, fetchFailed, flagMode, remotesMap.get(repo)),
				);
			}

			// Phase 3: display plan
			const willPull = assessments.filter((a) => a.outcome === "will-pull");
			const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
			const skipped = assessments.filter((a) => a.outcome === "skip");

			process.stderr.write("\n");
			for (const a of assessments) {
				const remotes = remotesMap.get(a.repo);
				const forkSuffix = remotes && remotes.upstream !== remotes.publish ? ` ← ${remotes.publish}` : "";
				if (a.outcome === "will-pull") {
					process.stderr.write(
						`  ${a.repo}   ${a.behind} commit${a.behind === 1 ? "" : "s"} to pull (${a.pullMode})${forkSuffix}\n`,
					);
				} else if (a.outcome === "up-to-date") {
					process.stderr.write(`  ${a.repo}   up to date\n`);
				} else {
					process.stderr.write(`  ${yellow(`${a.repo}   skipped — ${a.skipReason}`)}\n`);
				}
			}
			process.stderr.write("\n");

			if (willPull.length === 0) {
				info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
				return;
			}

			// Phase 4: confirm
			if (!options.yes) {
				if (!isTTY()) {
					error("Not a terminal. Use --yes to skip confirmation.");
					process.exit(1);
				}
				const ok = await confirm({
					message: `Pull ${willPull.length} repo(s)?`,
					default: false,
				});
				if (!ok) {
					process.stderr.write("Aborted.\n");
					process.exit(130);
				}
			}

			process.stderr.write("\n");

			// Phase 5: execute
			let pullOk = 0;

			for (const a of willPull) {
				inlineStart(a.repo, `pulling (${a.pullMode})`);
				const pullFlag = a.pullMode === "rebase" ? "--rebase" : "--no-rebase";
				const pullResult = await Bun.$`git -C ${a.repoDir} pull ${pullFlag}`.quiet().nothrow();
				if (pullResult.exitCode === 0) {
					inlineResult(a.repo, `pulled ${a.behind} commit(s) (${a.pullMode})`);
					pullOk++;
				} else {
					inlineResult(a.repo, red("failed"));
					process.stderr.write("\n");
					const errText = pullResult.stderr.toString().trim();
					if (errText) {
						for (const line of errText.split("\n")) {
							process.stderr.write(`  ${line}\n`);
						}
					}
					const subcommand = a.pullMode === "rebase" ? "rebase" : "merge";
					process.stderr.write("\n  To resolve:\n");
					process.stderr.write(`    cd ${a.repo}\n`);
					process.stderr.write(`    # fix any conflicts, then: git ${subcommand} --continue\n`);
					process.stderr.write(`    # or to undo: git ${subcommand} --abort\n`);
					process.stderr.write("\n  Then re-run 'arb pull' to continue with remaining repos.\n");
					process.exit(1);
				}
			}

			// Phase 6: summary
			process.stderr.write("\n");
			const parts = [`Pulled ${pullOk} repo(s)`];
			if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
			if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
			success(parts.join(", "));
		});
}

async function assessPullRepo(
	repo: string,
	repoDir: string,
	branch: string,
	localRepos: string[],
	fetchFailed: string[],
	flagMode: "rebase" | "merge" | undefined,
	remotes?: RepoRemotes,
): Promise<PullAssessment> {
	const publishRemote = remotes?.publish ?? "origin";
	const base: PullAssessment = { repo, repoDir, outcome: "skip", behind: 0, pullMode: "merge" };

	if (localRepos.includes(repo)) {
		return { ...base, skipReason: "local repo" };
	}

	if (fetchFailed.includes(repo)) {
		return { ...base, skipReason: "fetch failed" };
	}

	const bm = await checkBranchMatch(repoDir, branch);
	if (!bm.matches) {
		return { ...base, skipReason: `on branch ${bm.actual}, expected ${branch}` };
	}

	if (!(await remoteBranchExists(repoDir, branch, publishRemote))) {
		return { ...base, skipReason: "not pushed yet" };
	}

	// Check how many commits behind the publish remote
	const lr = await git(repoDir, "rev-list", "--left-right", "--count", `${publishRemote}/${branch}...HEAD`);
	if (lr.exitCode !== 0) {
		return { ...base, skipReason: `cannot compare with ${publishRemote}` };
	}

	const parts = lr.stdout.trim().split(/\s+/);
	const behind = Number.parseInt(parts[0] ?? "0", 10);

	const pullMode = flagMode ?? (await detectPullMode(repoDir, branch));

	if (behind === 0) {
		return { ...base, outcome: "up-to-date", pullMode };
	}

	return { ...base, outcome: "will-pull", behind, pullMode };
}

async function detectPullMode(repoDir: string, branch: string): Promise<"rebase" | "merge"> {
	const branchRebase = await Bun.$`git -C ${repoDir} config --get branch.${branch}.rebase`.quiet().nothrow();
	if (branchRebase.exitCode === 0) {
		return branchRebase.text().trim() !== "false" ? "rebase" : "merge";
	}
	const pullRebase = await Bun.$`git -C ${repoDir} config --get pull.rebase`.quiet().nothrow();
	if (pullRebase.exitCode === 0) {
		return pullRebase.text().trim() !== "false" ? "rebase" : "merge";
	}
	return "merge";
}
