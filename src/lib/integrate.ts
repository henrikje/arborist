import confirm from "@inquirer/confirm";
import { configGet } from "./config";
import { getShortHead, git, predictMergeConflict } from "./git";
import { dim, error, info, inlineResult, inlineStart, plural, success, warn, yellow } from "./output";
import { parallelFetch, reportFetchFailures } from "./parallel-fetch";
import { resolveRemotesMap } from "./remotes";
import { classifyRepos, resolveRepoSelection } from "./repos";
import { type RepoStatus, computeFlags, gatherRepoStatus } from "./status";
import { isTTY } from "./tty";
import type { ArbContext } from "./types";
import { requireBranch, requireWorkspace } from "./workspace-context";

type IntegrateMode = "rebase" | "merge";

interface RepoAssessment {
	repo: string;
	repoDir: string;
	outcome: "will-operate" | "up-to-date" | "skip";
	skipReason?: string;
	baseBranch?: string;
	upstreamRemote: string;
	behind: number;
	ahead: number;
	headSha: string;
	shallow: boolean;
	conflictPrediction?: "clean" | "conflict" | null;
}

export async function integrate(
	ctx: ArbContext,
	mode: IntegrateMode,
	options: { fetch?: boolean; yes?: boolean; dryRun?: boolean },
	repoArgs: string[],
): Promise<void> {
	const verb = mode === "rebase" ? "Rebase" : "Merge";
	const verbed = mode === "rebase" ? "Rebased" : "Merged";

	// Phase 1: context & repo selection
	const { wsDir, workspace } = requireWorkspace(ctx);
	const branch = await requireBranch(wsDir, workspace);
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");

	const selectedRepos = resolveRepoSelection(wsDir, repoArgs);

	// Resolve remotes for all repos
	const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);

	// Phase 2: fetch (unless --no-fetch)
	if (options.fetch !== false) {
		const { repos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
		if (fetchDirs.length > 0) {
			const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
			reportFetchFailures(repos, localRepos, fetchResults);
		}
	}

	// Phase 3: assess each repo
	const assessments: RepoAssessment[] = [];
	for (const repo of selectedRepos) {
		const repoDir = `${wsDir}/${repo}`;
		const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo));
		assessments.push(await assessRepo(status, repoDir, branch));
	}

	// Phase 3b: predict conflicts for will-operate repos
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-operate")
			.map(async (a) => {
				if (a.ahead > 0 && a.behind > 0) {
					const ref = `${a.upstreamRemote}/${a.baseBranch}`;
					const prediction = await predictMergeConflict(a.repoDir, ref);
					a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
				} else {
					a.conflictPrediction = "clean";
				}
			}),
	);

	// Phase 4: display plan & confirm
	const willOperate = assessments.filter((a) => a.outcome === "will-operate");
	const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
	const skipped = assessments.filter((a) => a.outcome === "skip");

	process.stderr.write("\n");
	for (const a of assessments) {
		if (a.outcome === "will-operate") {
			const diffParts = [a.behind > 0 && `${a.behind} behind`, a.ahead > 0 && `${a.ahead} ahead`]
				.filter(Boolean)
				.join(", ");
			const diffStr = diffParts ? ` \u2014 ${diffParts}` : "";
			const baseRef = `${a.upstreamRemote}/${a.baseBranch}`;
			const mergeType = mode === "merge" ? (a.ahead === 0 ? " (fast-forward)" : " (three-way)") : "";
			const action =
				mode === "rebase" ? `rebase ${branch} onto ${baseRef}` : `merge ${baseRef} into ${branch}${mergeType}`;
			let conflictHint = "";
			if (a.conflictPrediction === "conflict") {
				conflictHint = mode === "merge" ? ` ${yellow("(will conflict)")}` : ` ${yellow("(conflict likely)")}`;
			} else if (a.conflictPrediction === "clean") {
				conflictHint = mode === "merge" ? " (no conflict)" : " (conflict unlikely)";
			}
			const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
			process.stderr.write(`  ${a.repo}   ${action}${diffStr}${conflictHint}${headStr}\n`);
		} else if (a.outcome === "up-to-date") {
			process.stderr.write(`  ${a.repo}   up to date\n`);
		} else {
			process.stderr.write(`  ${yellow(`${a.repo}   skipped \u2014 ${a.skipReason}`)}\n`);
		}
	}

	// Shallow clone warning
	const shallowRepos = assessments.filter((a) => a.shallow);
	if (shallowRepos.length > 0) {
		process.stderr.write("\n");
		for (const a of shallowRepos) {
			warn(
				`  ${a.repo} is a shallow clone; ahead/behind counts may be inaccurate and ${mode} may fail if the merge base is beyond the shallow boundary`,
			);
		}
	}

	process.stderr.write("\n");

	if (willOperate.length === 0) {
		info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
		return;
	}

	if (options.dryRun) return;

	if (!options.yes) {
		if (!isTTY()) {
			error("Not a terminal. Use --yes to skip confirmation.");
			process.exit(1);
		}
		const ok = await confirm(
			{
				message: `${verb} ${plural(willOperate.length, "repo")}?`,
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

	// Phase 5: execute sequentially
	let succeeded = 0;
	const conflicted: { assessment: RepoAssessment; stdout: string }[] = [];
	for (const a of willOperate) {
		const ref = `${a.upstreamRemote}/${a.baseBranch}`;
		const progressMsg = mode === "rebase" ? `rebasing ${branch} onto ${ref}` : `merging ${ref} into ${branch}`;
		inlineStart(a.repo, progressMsg);

		const result = await git(a.repoDir, mode, ref);
		if (result.exitCode === 0) {
			const doneMsg = mode === "rebase" ? `rebased ${branch} onto ${ref}` : `merged ${ref} into ${branch}`;
			inlineResult(a.repo, doneMsg);
			succeeded++;
		} else {
			inlineResult(a.repo, yellow("conflict"));
			conflicted.push({ assessment: a, stdout: result.stdout });
		}
	}

	// Consolidated conflict report
	if (conflicted.length > 0) {
		const subcommand = mode === "rebase" ? "rebase" : "merge";
		process.stderr.write(`\n  ${conflicted.length} repo(s) have conflicts:\n`);
		for (const { assessment: a, stdout: gitStdout } of conflicted) {
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
	const parts = [`${verbed} ${plural(succeeded, "repo")}`];
	if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
	if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
	if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
	if (conflicted.length > 0) {
		warn(parts.join(", "));
		process.exit(1);
	} else {
		success(parts.join(", "));
	}
}

async function assessRepo(status: RepoStatus, repoDir: string, branch: string): Promise<RepoAssessment> {
	const upstreamRemote = status.base?.remote ?? "origin";

	const headSha = await getShortHead(repoDir);

	const base: RepoAssessment = {
		repo: status.name,
		repoDir,
		outcome: "skip",
		behind: 0,
		ahead: 0,
		upstreamRemote,
		headSha,
		shallow: status.identity.shallow,
	};

	// Local repo — no remote
	if (status.share === null) {
		return { ...base, skipReason: "local repo" };
	}

	// Operation in progress
	if (status.operation !== null) {
		return { ...base, skipReason: `${status.operation} in progress` };
	}

	// Branch check — detached or drifted
	if (status.identity.headMode.kind === "detached") {
		return { ...base, skipReason: "HEAD is detached" };
	}
	if (status.identity.headMode.branch !== branch) {
		return { ...base, skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}` };
	}

	// Dirty check
	const flags = computeFlags(status, branch);
	if (flags.isDirty) {
		return { ...base, skipReason: "uncommitted changes" };
	}

	// No base branch resolved
	if (status.base === null) {
		return { ...base, skipReason: "no base branch" };
	}

	// Up-to-date or will-operate
	if (status.base.behind === 0) {
		return { ...base, outcome: "up-to-date", baseBranch: status.base.ref, behind: 0, ahead: status.base.ahead };
	}

	return {
		...base,
		outcome: "will-operate",
		baseBranch: status.base.ref,
		behind: status.base.behind,
		ahead: status.base.ahead,
	};
}
