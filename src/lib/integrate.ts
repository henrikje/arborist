import { existsSync } from "node:fs";
import confirm from "@inquirer/confirm";
import { configGet } from "./config";
import { checkBranchMatch, getDefaultBranch, git, hasRemote, isRepoDirty, remoteBranchExists } from "./git";
import { error, info, inlineResult, inlineStart, red, success, yellow } from "./output";
import { parallelFetch, reportFetchFailures } from "./parallel-fetch";
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
	const verbing = mode === "rebase" ? "rebasing" : "merging";

	// Phase 1: context & repo selection
	const { wsDir, workspace } = requireWorkspace(ctx);
	const branch = await requireBranch(wsDir, workspace);
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");

	const selectedRepos = resolveRepoSelection(wsDir, repoArgs);

	// Phase 2: optional fetch
	if (options.fetch) {
		const { repos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
		if (fetchDirs.length > 0) {
			process.stderr.write(`Fetching ${fetchDirs.length} repo(s)...\n`);
			const fetchResults = await parallelFetch(fetchDirs);
			reportFetchFailures(repos, localRepos, fetchResults);
		}
	}

	// Phase 3: assess each repo
	const assessments: RepoAssessment[] = [];
	for (const repo of selectedRepos) {
		assessments.push(await assessRepo(repo, wsDir, ctx.reposDir, branch, configBase));
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
			process.stderr.write(`  ${a.repo}   ${mode} onto ${a.baseBranch}${diffStr}\n`);
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
		const ok = await confirm({
			message: `${verb} ${willOperate.length} repo(s)?`,
			default: false,
		});
		if (!ok) {
			process.stderr.write("Aborted.\n");
			process.exit(130);
		}
	}

	process.stderr.write("\n");

	// Phase 5: execute sequentially
	let succeeded = 0;
	for (const a of willOperate) {
		const ref = `origin/${a.baseBranch}`;
		inlineStart(a.repo, `${verbing} onto ${ref}`);

		const result = await git(a.repoDir, mode, ref);
		if (result.exitCode === 0) {
			inlineResult(a.repo, `${verbed.toLowerCase()} onto ${ref}`);
			succeeded++;
		} else {
			inlineResult(a.repo, red("conflict"));
			process.stderr.write("\n");
			const subcommand = mode === "rebase" ? "rebase" : "merge";
			process.stderr.write(`  ${a.repo} has conflicts. To resolve:\n`);
			process.stderr.write(`    cd ${a.repo}\n`);
			process.stderr.write(`    # fix conflicts, then: git ${subcommand} --continue\n`);
			process.stderr.write(`    # or to undo: git ${subcommand} --abort\n`);
			process.stderr.write(`\n  Then re-run 'arb ${mode}' to continue with remaining repos.\n`);
			process.exit(1);
		}
	}

	// Phase 6: summary
	process.stderr.write("\n");
	const parts = [`${verbed} ${succeeded} repo(s)`];
	if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
	if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
	success(parts.join(", "));
}

async function assessRepo(
	repo: string,
	wsDir: string,
	reposDir: string,
	branch: string,
	configBase: string | null,
): Promise<RepoAssessment> {
	const repoDir = `${wsDir}/${repo}`;
	const repoPath = `${reposDir}/${repo}`;
	const base: RepoAssessment = { repo, repoDir, outcome: "skip", behind: 0, ahead: 0 };

	// Check remote
	if (!(await hasRemote(repoPath))) {
		return { ...base, skipReason: "local repo" };
	}

	// Detect in-progress operation (before branch check — during rebase/merge HEAD may be detached)
	const gitDirResult = await git(repoDir, "rev-parse", "--git-dir");
	if (gitDirResult.exitCode === 0) {
		const gitDir = gitDirResult.stdout.trim();
		const absGitDir = gitDir.startsWith("/") ? gitDir : `${repoDir}/${gitDir}`;
		if (existsSync(`${absGitDir}/rebase-merge`) || existsSync(`${absGitDir}/rebase-apply`)) {
			return { ...base, skipReason: "rebase in progress" };
		}
		if (existsSync(`${absGitDir}/MERGE_HEAD`)) {
			return { ...base, skipReason: "merge in progress" };
		}
		if (existsSync(`${absGitDir}/CHERRY_PICK_HEAD`)) {
			return { ...base, skipReason: "cherry-pick in progress" };
		}
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
		if (await remoteBranchExists(repoPath, configBase)) {
			baseBranch = configBase;
		}
	}
	if (!baseBranch) {
		baseBranch = await getDefaultBranch(repoPath);
	}
	if (!baseBranch) {
		return { ...base, skipReason: "no base branch" };
	}

	// Ahead/behind base
	const lr = await git(repoDir, "rev-list", "--left-right", "--count", `origin/${baseBranch}...HEAD`);
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
