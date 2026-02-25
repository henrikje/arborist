import { basename } from "node:path";
import { configGet, writeConfig } from "./config";
import { ArbError } from "./errors";
import {
	branchExistsLocally,
	detectBranchMerged,
	getDefaultBranch,
	getShortHead,
	git,
	predictMergeConflict,
	predictStashPopConflict,
	remoteBranchExists,
} from "./git";
import { confirmOrExit, runPlanFlow } from "./mutation-flow";
import { dim, dryRunNotice, error, info, inlineResult, inlineStart, plural, success, warn, yellow } from "./output";
import { resolveRemotesMap } from "./remotes";
import { resolveRepoSelection, workspaceRepoDirs } from "./repos";
import { type RepoStatus, computeFlags, gatherRepoStatus } from "./status";
import type { ArbContext } from "./types";
import { workspaceBranch } from "./workspace-branch";
import { requireBranch, requireWorkspace } from "./workspace-context";

type IntegrateMode = "rebase" | "merge";

export interface RepoAssessment {
	repo: string;
	repoDir: string;
	outcome: "will-operate" | "up-to-date" | "skip";
	skipReason?: string;
	baseBranch?: string;
	baseRemote: string;
	behind: number;
	ahead: number;
	headSha: string;
	shallow: boolean;
	conflictPrediction?: "no-conflict" | "clean" | "conflict" | null;
	retargetFrom?: string;
	retargetTo?: string;
	retargetBlocked?: boolean;
	retargetWarning?: string;
	needsStash?: boolean;
	stashPopConflictFiles?: string[];
}

export async function integrate(
	ctx: ArbContext,
	mode: IntegrateMode,
	options: { fetch?: boolean; yes?: boolean; dryRun?: boolean; retarget?: string | boolean; autostash?: boolean },
	repoArgs: string[],
): Promise<void> {
	const verb = mode === "rebase" ? "Rebase" : "Merge";
	const verbed = mode === "rebase" ? "Rebased" : "Merged";
	const retargetExplicit = typeof options.retarget === "string" && mode === "rebase" ? options.retarget : null;
	const retarget = (options.retarget === true || retargetExplicit !== null) && mode === "rebase";

	// Phase 1: context & repo selection
	const { wsDir, workspace } = requireWorkspace(ctx);
	const branch = await requireBranch(wsDir, workspace);
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");

	if (retargetExplicit) {
		if (retargetExplicit === branch) {
			error(`Cannot retarget to ${retargetExplicit} — that is the current feature branch.`);
			throw new ArbError(`Cannot retarget to ${retargetExplicit} — that is the current feature branch.`);
		}
		if (retargetExplicit === configBase) {
			error(`Cannot retarget to ${retargetExplicit} — that is already the configured base branch.`);
			throw new ArbError(`Cannot retarget to ${retargetExplicit} — that is already the configured base branch.`);
		}
	}

	const selectedRepos = resolveRepoSelection(wsDir, repoArgs);

	// Resolve remotes for all repos
	const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);

	// Phase 2: fetch
	const shouldFetch = options.fetch !== false;
	const fetchDirs = workspaceRepoDirs(wsDir);
	const repos = fetchDirs.map((d) => basename(d));

	const autostash = options.autostash === true;
	const assess = async (fetchFailed: string[]) => {
		return Promise.all(
			selectedRepos.map(async (repo) => {
				const repoDir = `${wsDir}/${repo}`;
				const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo));
				return assessRepo(status, repoDir, branch, fetchFailed, retarget, retargetExplicit, autostash);
			}),
		);
	};

	const assessments = await runPlanFlow({
		shouldFetch,
		fetchDirs,
		reposForFetchReport: repos,
		remotesMap,
		assess,
		postAssess: predictIntegrateConflicts,
		formatPlan: (nextAssessments) => formatIntegratePlan(nextAssessments, mode, branch),
	});

	// All-or-nothing check: when retarget is active, any non-local skipped repo blocks the entire retarget
	if (retarget) {
		const hasRetargetWork = assessments.some((a) => a.retargetTo || a.retargetBlocked);
		if (hasRetargetWork) {
			const blockedRepos = assessments.filter(
				(a) => a.outcome === "skip" && !a.skipReason?.startsWith("no base branch"),
			);
			if (blockedRepos.length > 0) {
				error("Cannot retarget: some repos are blocked. Fix these issues and retry:");
				for (const a of blockedRepos) {
					process.stderr.write(`  ${a.repo} — ${a.skipReason}\n`);
				}
				throw new ArbError("Cannot retarget: some repos are blocked.");
			}
		}
	}

	// Phase 4: confirm
	const willOperate = assessments.filter((a) => a.outcome === "will-operate");
	const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
	const skipped = assessments.filter((a) => a.outcome === "skip");

	if (willOperate.length === 0) {
		info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
		return;
	}

	if (options.dryRun) {
		dryRunNotice();
		return;
	}

	await confirmOrExit({
		yes: options.yes,
		message: `${verb} ${plural(willOperate.length, "repo")}?`,
	});

	process.stderr.write("\n");

	// Phase 5: execute sequentially
	let succeeded = 0;
	const conflicted: { assessment: RepoAssessment; stdout: string; stderr: string }[] = [];
	const stashPopFailed: RepoAssessment[] = [];
	for (const a of willOperate) {
		const ref = `${a.baseRemote}/${a.baseBranch}`;

		let result: { exitCode: number; stdout: string; stderr: string };
		if (a.retargetFrom) {
			const remoteRefExists = await remoteBranchExists(a.repoDir, a.retargetFrom, a.baseRemote);
			const oldBaseRef = remoteRefExists ? `${a.baseRemote}/${a.retargetFrom}` : a.retargetFrom;
			const progressMsg = `rebasing ${branch} onto ${ref} from ${a.retargetFrom} (retarget)`;
			inlineStart(a.repo, progressMsg);
			const retargetArgs = ["rebase"];
			if (a.needsStash) retargetArgs.push("--autostash");
			retargetArgs.push("--onto", ref, oldBaseRef);
			result = await git(a.repoDir, ...retargetArgs);
		} else if (mode === "rebase") {
			const progressMsg = `rebasing ${branch} onto ${ref}`;
			inlineStart(a.repo, progressMsg);
			const rebaseArgs = ["rebase"];
			if (a.needsStash) rebaseArgs.push("--autostash");
			rebaseArgs.push(ref);
			result = await git(a.repoDir, ...rebaseArgs);
		} else {
			// Merge mode
			const progressMsg = `merging ${ref} into ${branch}`;
			inlineStart(a.repo, progressMsg);
			if (a.needsStash) {
				await git(a.repoDir, "stash", "push", "-m", "arb: autostash before merge");
			}
			result = await git(a.repoDir, "merge", ref);
		}

		if (result.exitCode === 0) {
			// For merge mode with stash, pop the stash
			let stashPopOk = true;
			if (a.needsStash && mode === "merge") {
				const popResult = await git(a.repoDir, "stash", "pop");
				if (popResult.exitCode !== 0) {
					stashPopOk = false;
					stashPopFailed.push(a);
				}
			}
			let doneMsg: string;
			if (a.retargetFrom) {
				doneMsg = `rebased ${branch} onto ${ref} from ${a.retargetFrom} (retarget)`;
			} else {
				doneMsg = mode === "rebase" ? `rebased ${branch} onto ${ref}` : `merged ${ref} into ${branch}`;
			}
			if (!stashPopOk) {
				doneMsg += ` ${yellow("(stash pop failed)")}`;
			}
			inlineResult(a.repo, doneMsg);
			succeeded++;
		} else {
			// For rebase mode, git rebase --autostash handles stash internally.
			// For merge mode with stash, do NOT pop if merge conflicted.
			inlineResult(a.repo, yellow("conflict"));
			conflicted.push({ assessment: a, stdout: result.stdout, stderr: result.stderr });
		}
	}

	// Consolidated conflict report
	if (conflicted.length > 0) {
		const subcommand = mode === "rebase" ? "rebase" : "merge";
		process.stderr.write(`\n  ${conflicted.length} repo(s) have conflicts:\n`);
		for (const { assessment: a, stdout: gitStdout, stderr: gitStderr } of conflicted) {
			process.stderr.write(`\n    ${a.repo}\n`);
			const combined = `${gitStdout}\n${gitStderr}`;
			for (const line of combined.split("\n").filter((l) => l.startsWith("CONFLICT"))) {
				process.stderr.write(`      ${dim(line)}\n`);
			}
			process.stderr.write(`      cd ${a.repo}\n`);
			process.stderr.write(`      # fix conflicts, then: git ${subcommand} --continue\n`);
			process.stderr.write(`      # or to undo: git ${subcommand} --abort\n`);
		}
	}

	// Stash pop failure report
	if (stashPopFailed.length > 0) {
		const subcommand = mode === "rebase" ? "Rebase" : "Merge";
		process.stderr.write(`\n  ${stashPopFailed.length} repo(s) need manual stash application:\n`);
		for (const a of stashPopFailed) {
			process.stderr.write(`\n    ${a.repo}\n`);
			process.stderr.write(`      ${subcommand} succeeded, but stash pop conflicted.\n`);
			process.stderr.write(`      cd ${a.repo}\n`);
			process.stderr.write("      git stash pop    # re-apply and resolve conflicts\n");
			process.stderr.write("      # or: git stash show  # inspect stashed changes\n");
		}
	}

	// Update config after successful retarget
	const retargetAssessments = willOperate.filter((a) => a.retargetTo);
	if (retargetAssessments.length > 0 && conflicted.length === 0) {
		const retargetTo = retargetAssessments[0]?.retargetTo;
		if (retargetTo) {
			const configFile = `${wsDir}/.arbws/config`;
			const wb = await workspaceBranch(wsDir);
			const wsBranch = wb?.branch ?? branch;
			// Resolve the repo's default branch to check if retargetTo matches
			// If retargeting to the default branch, remove the base key
			// If retargeting to a non-default branch, set it as the new base
			const firstRetarget = retargetAssessments[0];
			const repoDefault = firstRetarget
				? await getDefaultBranch(firstRetarget.repoDir, firstRetarget.baseRemote)
				: null;
			if (repoDefault && retargetTo !== repoDefault) {
				writeConfig(configFile, wsBranch, retargetTo);
			} else {
				writeConfig(configFile, wsBranch, undefined);
			}
		}
	}

	// Phase 6: summary
	process.stderr.write("\n");
	const retargetedCount = willOperate.filter(
		(a) => a.retargetFrom && !conflicted.some((c) => c.assessment === a),
	).length;
	const normalCount = succeeded - retargetedCount;
	const parts: string[] = [];
	if (retargetedCount > 0) parts.push(`Retargeted ${plural(retargetedCount, "repo")}`);
	if (normalCount > 0 || retargetedCount === 0) parts.push(`${verbed} ${plural(normalCount, "repo")}`);
	if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
	if (stashPopFailed.length > 0) parts.push(`${stashPopFailed.length} stash pop failed`);
	if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
	if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
	if (conflicted.length > 0 || stashPopFailed.length > 0) {
		warn(parts.join(", "));
		throw new ArbError(parts.join(", "));
	}
	success(parts.join(", "));
}

export function formatIntegratePlan(assessments: RepoAssessment[], mode: IntegrateMode, branch: string): string {
	let out = "\n";
	for (const a of assessments) {
		if (a.outcome === "will-operate") {
			const baseRef = `${a.baseRemote}/${a.baseBranch}`;

			if (a.retargetFrom) {
				// Retarget display
				out += `  ${a.repo}   rebase onto ${baseRef} from ${a.retargetFrom} (retarget)`;
				if (a.retargetWarning) {
					out += ` ${yellow(`(${a.retargetWarning})`)}`;
				}
				if (a.needsStash) {
					if (a.stashPopConflictFiles && a.stashPopConflictFiles.length > 0) {
						out += ` ${yellow("(autostash, stash pop conflict likely)")}`;
					} else if (a.stashPopConflictFiles) {
						out += " (autostash, stash pop conflict unlikely)";
					} else {
						out += " (autostash)";
					}
				}
				const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
				out += `${headStr}\n`;
			} else {
				const diffParts = [a.behind > 0 && `${a.behind} behind`, a.ahead > 0 && `${a.ahead} ahead`]
					.filter(Boolean)
					.join(", ");
				const diffStr = diffParts ? ` \u2014 ${diffParts}` : "";
				const mergeType = mode === "merge" ? (a.ahead === 0 ? " (fast-forward)" : " (three-way)") : "";
				const action =
					mode === "rebase" ? `rebase ${branch} onto ${baseRef}` : `merge ${baseRef} into ${branch}${mergeType}`;
				let conflictHint = "";
				if (a.conflictPrediction === "conflict") {
					conflictHint = mode === "merge" ? ` ${yellow("(will conflict)")}` : ` ${yellow("(conflict likely)")}`;
				} else if (a.conflictPrediction === "no-conflict") {
					conflictHint = " (no conflict)";
				} else if (a.conflictPrediction === "clean") {
					conflictHint = mode === "merge" ? " (no conflict)" : " (conflict unlikely)";
				}
				let stashHint = "";
				if (a.needsStash) {
					if (a.stashPopConflictFiles && a.stashPopConflictFiles.length > 0) {
						stashHint = ` ${yellow("(autostash, stash pop conflict likely)")}`;
					} else if (a.stashPopConflictFiles) {
						stashHint = " (autostash, stash pop conflict unlikely)";
					} else {
						stashHint = " (autostash)";
					}
				}
				const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
				out += `  ${a.repo}   ${action}${diffStr}${conflictHint}${stashHint}${headStr}\n`;
			}
		} else if (a.outcome === "up-to-date") {
			out += `  ${a.repo}   up to date\n`;
		} else {
			out += `  ${yellow(`${a.repo}   skipped \u2014 ${a.skipReason}`)}\n`;
		}
	}

	// Shallow clone warnings (included in plan block so they get cleared on re-render)
	const shallowRepos = assessments.filter((a) => a.shallow);
	if (shallowRepos.length > 0) {
		out += "\n";
		for (const a of shallowRepos) {
			out += `${yellow(`  ${a.repo} is a shallow clone; ahead/behind counts may be inaccurate and ${mode} may fail if the merge base is beyond the shallow boundary`)}\n`;
		}
	}

	out += "\n";
	return out;
}

async function predictIntegrateConflicts(assessments: RepoAssessment[]): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-operate")
			.map(async (a) => {
				const ref = `${a.baseRemote}/${a.baseBranch}`;
				if (!a.retargetFrom && a.ahead > 0 && a.behind > 0) {
					const prediction = await predictMergeConflict(a.repoDir, ref);
					a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
				} else if (!a.retargetFrom) {
					a.conflictPrediction = "no-conflict";
				}
				if (a.needsStash) {
					const stashPrediction = await predictStashPopConflict(a.repoDir, ref);
					a.stashPopConflictFiles = stashPrediction.overlapping;
				}
			}),
	);
}

export function classifyRepo(
	status: RepoStatus,
	repoDir: string,
	branch: string,
	fetchFailed: string[],
	autostash: boolean,
	headSha: string,
): RepoAssessment {
	const base: RepoAssessment = {
		repo: status.name,
		repoDir,
		outcome: "skip",
		behind: 0,
		ahead: 0,
		baseRemote: "",
		headSha,
		shallow: status.identity.shallow,
	};

	// Fetch failed for this repo
	if (fetchFailed.includes(status.name)) {
		return { ...base, skipReason: "fetch failed" };
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
		if (!autostash) {
			return { ...base, skipReason: "uncommitted changes (use --autostash)" };
		}
		// Only stash if there are staged or modified files (not untracked-only)
		if (status.local.staged > 0 || status.local.modified > 0) {
			base.needsStash = true;
		}
	}

	// No base branch resolved
	if (status.base === null) {
		return { ...base, skipReason: "no base branch" };
	}

	// After this point, status.base is guaranteed non-null.
	// Remote repos must have a resolved base remote to proceed.
	if (!status.base.remote) {
		return { ...base, skipReason: "no base remote" };
	}
	base.baseRemote = status.base.remote;

	// Stacked base branch has been merged into default
	if (status.base.baseMergedIntoDefault != null) {
		return {
			...base,
			skipReason: `base branch ${status.base.configuredRef ?? status.base.ref} was merged into default (use --retarget)`,
		};
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

async function assessRepo(
	status: RepoStatus,
	repoDir: string,
	branch: string,
	fetchFailed: string[],
	retarget = false,
	retargetExplicit: string | null = null,
	autostash = false,
): Promise<RepoAssessment> {
	const headSha = await getShortHead(repoDir);
	const classified = classifyRepo(status, repoDir, branch, fetchFailed, autostash, headSha);

	// Hard skips from basic checks (steps 1–7) — retarget can't help.
	// Only the baseMergedIntoDefault skip should pass through to retarget logic.
	if (classified.outcome === "skip" && !classified.skipReason?.includes("was merged into default")) {
		return classified;
	}

	const baseRemote = classified.baseRemote;
	const base = status.base;

	// Explicit retarget to a specified branch
	if (retargetExplicit) {
		// Fell-back repos (configuredRef set, baseMergedIntoDefault null) get normal classification
		if (base && base.configuredRef !== null && base.baseMergedIntoDefault == null) {
			return classified;
		}

		// Validate target branch exists on remote
		const targetExists = await remoteBranchExists(repoDir, retargetExplicit, baseRemote);
		if (!targetExists) {
			return {
				...classified,
				outcome: "skip",
				skipReason: `target branch ${retargetExplicit} not found on ${baseRemote}`,
				retargetBlocked: true,
			};
		}

		// Resolve old base ref (the branch we're retargeting away from)
		const oldBaseName = base?.configuredRef ?? base?.ref ?? "";
		const oldBaseRemoteExists = await remoteBranchExists(repoDir, oldBaseName, baseRemote);
		const oldBaseLocalExists = !oldBaseRemoteExists ? await branchExistsLocally(repoDir, oldBaseName) : false;
		if (!oldBaseRemoteExists && !oldBaseLocalExists) {
			return {
				...classified,
				outcome: "skip",
				skipReason: `base branch ${oldBaseName} not found — cannot determine rebase boundary`,
				retargetBlocked: true,
			};
		}

		// Per-repo merge detection
		const targetRef = `${baseRemote}/${retargetExplicit}`;
		const oldBaseRef = oldBaseRemoteExists ? `${baseRemote}/${oldBaseName}` : oldBaseName;
		let retargetWarning: string | undefined;
		const mergeResult = await detectBranchMerged(repoDir, targetRef, 200, oldBaseRef);
		if (mergeResult === null) {
			retargetWarning = `base branch ${oldBaseName} may not be merged`;
		}

		// Up-to-date check: already on target and 0 behind
		if (base?.ref === retargetExplicit && base?.behind === 0) {
			return { ...classified, outcome: "up-to-date", baseBranch: retargetExplicit };
		}

		return {
			...classified,
			outcome: "will-operate",
			baseBranch: retargetExplicit,
			retargetFrom: oldBaseName,
			retargetTo: retargetExplicit,
			retargetWarning,
			behind: base?.behind ?? 0,
			ahead: base?.ahead ?? 0,
		};
	}

	// Stacked base branch has been merged into default (auto-detect)
	if (base?.baseMergedIntoDefault != null) {
		if (!retarget) {
			return classified;
		}

		// Resolve the true default branch for retarget
		const trueDefault = await getDefaultBranch(repoDir, baseRemote);
		if (!trueDefault) {
			return { ...classified, outcome: "skip", skipReason: "cannot resolve default branch for retarget" };
		}

		// For squash-merged repos, check if already retargeted
		if (base.baseMergedIntoDefault === "squash") {
			const defaultRef = `${baseRemote}/${trueDefault}`;
			const alreadyOnDefault = await git(repoDir, "merge-base", "--is-ancestor", defaultRef, "HEAD");
			if (alreadyOnDefault.exitCode === 0) {
				return { ...classified, outcome: "up-to-date", baseBranch: trueDefault };
			}
		}

		return {
			...classified,
			outcome: "will-operate",
			baseBranch: trueDefault,
			retargetFrom: base.configuredRef ?? base.ref,
			retargetTo: trueDefault,
			behind: base.behind,
			ahead: base.ahead,
		};
	}

	return classified;
}
