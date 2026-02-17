import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { getShortHead } from "../lib/git";
import { dim, error, info, inlineResult, inlineStart, plural, success, warn, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { resolveRemotesMap } from "../lib/remotes";
import { classifyRepos, resolveRepoSelection } from "../lib/repos";
import { type RepoStatus, gatherRepoStatus } from "../lib/status";
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
	headSha: string;
}

export function registerPullCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("pull [repos...]")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("--rebase", "Pull with rebase")
		.option("--merge", "Pull with merge")
		.summary("Pull the feature branch from the publish remote")
		.description(
			"Pull the feature branch for all repos, or only the named repos. Pulls from the publish remote (origin by default, or as configured for fork workflows). Fetches in parallel, then shows a plan and asks for confirmation before pulling. Repos that haven't been pushed yet or where the remote branch has been deleted are skipped. If any repos conflict, arb continues with the remaining repos and reports all conflicts at the end.",
		)
		.action(
			async (repoArgs: string[], options: { rebase?: boolean; merge?: boolean; yes?: boolean; dryRun?: boolean }) => {
				if (options.rebase && options.merge) {
					error("Cannot use both --rebase and --merge");
					process.exit(1);
				}

				const flagMode: "rebase" | "merge" | undefined = options.rebase
					? "rebase"
					: options.merge
						? "merge"
						: undefined;
				const ctx = getCtx();
				const { wsDir, workspace } = requireWorkspace(ctx);
				const branch = await requireBranch(wsDir, workspace);

				const selectedRepos = resolveRepoSelection(wsDir, repoArgs);
				const selectedSet = new Set(selectedRepos);
				const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);
				const configBase = configGet(`${wsDir}/.arbws/config`, "base");

				// Phase 1: parallel fetch (only selected repos)
				const { repos: allRepos, fetchDirs: allFetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
				const repos = allRepos.filter((r) => selectedSet.has(r));
				const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));

				let fetchResults = new Map<string, { exitCode: number; output: string }>();
				if (fetchDirs.length > 0) {
					process.stderr.write(`Fetching ${plural(fetchDirs.length, "repo")}...\n`);
					fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
				}

				const fetchFailed = reportFetchFailures(repos, localRepos, fetchResults);

				// Phase 2: assess each repo
				const assessments: PullAssessment[] = [];
				for (const repo of repos) {
					const repoDir = `${wsDir}/${repo}`;
					const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo));
					assessments.push(await assessPullRepo(status, repoDir, branch, fetchFailed, flagMode));
				}

				// Phase 3: display plan
				const willPull = assessments.filter((a) => a.outcome === "will-pull");
				const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
				const skipped = assessments.filter((a) => a.outcome === "skip");

				process.stderr.write("\n");
				for (const a of assessments) {
					const remotes = remotesMap.get(a.repo);
					const forkSuffix = remotes && remotes.upstream !== remotes.publish ? ` ← ${remotes.publish}` : "";
					const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
					if (a.outcome === "will-pull") {
						process.stderr.write(
							`  ${a.repo}   ${plural(a.behind, "commit")} to pull (${a.pullMode})${forkSuffix}${headStr}\n`,
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

				if (options.dryRun) return;

				// Phase 4: confirm
				if (!options.yes) {
					if (!isTTY()) {
						error("Not a terminal. Use --yes to skip confirmation.");
						process.exit(1);
					}
					const ok = await confirm(
						{
							message: `Pull ${plural(willPull.length, "repo")}?`,
							default: false,
						},
						{ output: process.stderr },
					);
					if (!ok) {
						process.stderr.write("Aborted.\n");
						process.exit(130);
					}
				}

				process.stderr.write("\n");

				// Phase 5: execute
				let pullOk = 0;
				const conflicted: { assessment: PullAssessment; stdout: string }[] = [];

				for (const a of willPull) {
					inlineStart(a.repo, `pulling (${a.pullMode})`);
					const pullRemote = remotesMap.get(a.repo)?.publish ?? "origin";
					const pullFlag = a.pullMode === "rebase" ? "--rebase" : "--no-rebase";
					const pullResult = await Bun.$`git -C ${a.repoDir} pull ${pullFlag} ${pullRemote} ${branch}`
						.cwd(a.repoDir)
						.quiet()
						.nothrow();
					if (pullResult.exitCode === 0) {
						inlineResult(a.repo, `pulled ${plural(a.behind, "commit")} (${a.pullMode})`);
						pullOk++;
					} else {
						inlineResult(a.repo, yellow("conflict"));
						conflicted.push({ assessment: a, stdout: pullResult.stdout.toString() });
					}
				}

				// Consolidated conflict report
				if (conflicted.length > 0) {
					process.stderr.write(`\n  ${conflicted.length} repo(s) have conflicts:\n`);
					for (const { assessment: a, stdout: gitStdout } of conflicted) {
						const subcommand = a.pullMode === "rebase" ? "rebase" : "merge";
						process.stderr.write(`\n    ${a.repo}\n`);
						for (const line of gitStdout.split("\n").filter((l) => l.startsWith("CONFLICT"))) {
							process.stderr.write(`      ${dim(line)}\n`);
						}
						process.stderr.write(`      cd ${a.repo}\n`);
						process.stderr.write(`      # fix conflicts, then: git ${subcommand} --continue\n`);
						process.stderr.write(`      # or to undo: git ${subcommand} --abort\n`);
					}
				}

				// Phase 6: summary
				process.stderr.write("\n");
				const parts = [`Pulled ${plural(pullOk, "repo")}`];
				if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
				if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
				if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
				if (conflicted.length > 0) {
					warn(parts.join(", "));
					process.exit(1);
				} else {
					success(parts.join(", "));
				}
			},
		);
}

async function assessPullRepo(
	status: RepoStatus,
	repoDir: string,
	branch: string,
	fetchFailed: string[],
	flagMode: "rebase" | "merge" | undefined,
): Promise<PullAssessment> {
	const headSha = await getShortHead(repoDir);

	const base: PullAssessment = { repo: status.name, repoDir, outcome: "skip", behind: 0, pullMode: "merge", headSha };

	// Local repo — no publish remote
	if (status.publish === null) {
		return { ...base, skipReason: "local repo" };
	}

	// Fetch failed for this repo
	if (fetchFailed.includes(status.name)) {
		return { ...base, skipReason: "fetch failed" };
	}

	// Branch check — detached or drifted
	if (status.identity.headMode.kind === "detached") {
		return { ...base, skipReason: "HEAD is detached" };
	}
	if (status.identity.headMode.branch !== branch) {
		return { ...base, skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}` };
	}

	// Not pushed yet
	if (status.publish.refMode === "noRef") {
		return { ...base, skipReason: "not pushed yet" };
	}

	// Remote branch gone
	if (status.publish.refMode === "gone") {
		return { ...base, skipReason: "remote branch gone" };
	}

	// Determine pull mode
	const pullMode = flagMode ?? (await detectPullMode(repoDir, branch));

	// Check toPull count
	const toPull = status.publish.toPull ?? 0;
	if (toPull === 0) {
		return { ...base, outcome: "up-to-date", pullMode };
	}

	return { ...base, outcome: "will-pull", behind: toPull, pullMode };
}

async function detectPullMode(repoDir: string, branch: string): Promise<"rebase" | "merge"> {
	const branchRebase = await Bun.$`git -C ${repoDir} config --get branch.${branch}.rebase`
		.cwd(repoDir)
		.quiet()
		.nothrow();
	if (branchRebase.exitCode === 0) {
		return branchRebase.text().trim() !== "false" ? "rebase" : "merge";
	}
	const pullRebase = await Bun.$`git -C ${repoDir} config --get pull.rebase`.cwd(repoDir).quiet().nothrow();
	if (pullRebase.exitCode === 0) {
		return pullRebase.text().trim() !== "false" ? "rebase" : "merge";
	}
	return "merge";
}
