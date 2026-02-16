import confirm from "@inquirer/confirm";
import { configGet } from "./config";
import {
	checkBranchMatch,
	detectOperation,
	getDefaultBranch,
	git,
	hasRemote,
	isRepoDirty,
	remoteBranchExists,
} from "./git";
import { dim, error, info, inlineResult, inlineStart, plural, success, warn, yellow } from "./output";
import { parallelFetch, reportFetchFailures } from "./parallel-fetch";
import { type RepoRemotes, resolveRemotesMap } from "./remotes";
import { classifyRepos, resolveRepoSelection } from "./repos";
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
}

export async function integrate(
	ctx: ArbContext,
	mode: IntegrateMode,
	options: { fetch?: boolean; yes?: boolean },
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
			process.stderr.write(`Fetching ${plural(fetchDirs.length, "repo")}...\n`);
			const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
			reportFetchFailures(repos, localRepos, fetchResults);
		}
	}

	// Phase 3: assess each repo
	const assessments: RepoAssessment[] = [];
	for (const repo of selectedRepos) {
		assessments.push(await assessRepo(repo, wsDir, ctx.reposDir, branch, configBase, remotesMap.get(repo)));
	}

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
			const action = mode === "rebase" ? `rebase ${branch} onto ${baseRef}` : `merge ${baseRef} into ${branch}`;
			process.stderr.write(`  ${a.repo}   ${action}${diffStr}\n`);
		} else if (a.outcome === "up-to-date") {
			process.stderr.write(`  ${a.repo}   up to date\n`);
		} else {
			process.stderr.write(`  ${yellow(`${a.repo}   skipped \u2014 ${a.skipReason}`)}\n`);
		}
	}
	process.stderr.write("\n");

	if (willOperate.length === 0) {
		info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
		return;
	}

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

async function assessRepo(
	repo: string,
	wsDir: string,
	reposDir: string,
	branch: string,
	configBase: string | null,
	remotes?: RepoRemotes,
): Promise<RepoAssessment> {
	const repoDir = `${wsDir}/${repo}`;
	const repoPath = `${reposDir}/${repo}`;
	const upstreamRemote = remotes?.upstream ?? "origin";
	const base: RepoAssessment = { repo, repoDir, outcome: "skip", behind: 0, ahead: 0, upstreamRemote };

	// Check remote
	if (!(await hasRemote(repoPath))) {
		return { ...base, skipReason: "local repo" };
	}

	// Detect in-progress operation (before branch check — during rebase/merge HEAD may be detached)
	const operation = await detectOperation(repoDir);
	if (operation) {
		return { ...base, skipReason: `${operation} in progress` };
	}

	// Check branch match
	const bm = await checkBranchMatch(repoDir, branch);
	if (!bm.matches) {
		return { ...base, skipReason: `on branch ${bm.actual}, expected ${branch}` };
	}

	// Check dirty
	if (await isRepoDirty(repoDir)) {
		return { ...base, skipReason: "uncommitted changes" };
	}

	// Resolve base branch
	let baseBranch: string | null = null;
	if (configBase) {
		if (await remoteBranchExists(repoPath, configBase, upstreamRemote)) {
			baseBranch = configBase;
		}
	}
	if (!baseBranch) {
		baseBranch = await getDefaultBranch(repoPath, upstreamRemote);
	}
	if (!baseBranch) {
		return { ...base, skipReason: "no base branch" };
	}

	// Ahead/behind base
	const lr = await git(repoDir, "rev-list", "--left-right", "--count", `${upstreamRemote}/${baseBranch}...HEAD`);
	if (lr.exitCode !== 0) {
		return { ...base, skipReason: "cannot compare with base" };
	}

	const parts = lr.stdout.trim().split(/\s+/);
	const behind = Number.parseInt(parts[0] ?? "0", 10);
	const ahead = Number.parseInt(parts[1] ?? "0", 10);

	if (behind === 0) {
		return { ...base, outcome: "up-to-date", baseBranch, behind: 0, ahead };
	}

	return { ...base, outcome: "will-operate", baseBranch, behind, ahead };
}
