import { basename } from "node:path";
import { configGet, writeConfig } from "../core/config";
import { ArbError } from "../core/errors";
import type { ArbContext } from "../core/types";
import {
	analyzeRetargetReplay,
	branchExistsLocally,
	detectBranchMerged,
	getCommitsBetweenFull,
	getDiffShortstat,
	getMergeBase,
	getShortHead,
	git,
	matchDivergedCommits,
	predictMergeConflict,
	predictRebaseConflictCommits,
	predictStashPopConflict,
	remoteBranchExists,
} from "../git/git";
import { assertMinimumGitVersion } from "../git/git";
import { GitCache } from "../git/git-cache";
import { buildConflictReport, buildStashPopFailureReport } from "../render/conflict-report";
import { formatBranchGraph } from "../render/integrate-graph";
import type { Cell, OutputNode } from "../render/model";
import { cell, suffix } from "../render/model";
import { skipCell, upToDateCell } from "../render/plan-format";
import { type RenderContext, finishSummary, render } from "../render/render";
import { VERBOSE_COMMIT_LIMIT, verboseCommitsToNodes } from "../render/status-verbose";
import {
	type RepoStatus,
	computeFlags,
	gatherRepoStatus,
	repoMatchesWhere,
	resolveWhereFilter,
} from "../status/status";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, yellow } from "../terminal/output";
import { isTTY } from "../terminal/tty";
import { workspaceBranch } from "../workspace/branch";
import { requireBranch, requireWorkspace } from "../workspace/context";
import { resolveRepoSelection, workspaceRepoDirs } from "../workspace/repos";
import { confirmOrExit, runPlanFlow } from "./mutation-flow";
export type { RepoAssessment } from "./types";
import type { RepoAssessment } from "./types";

type IntegrateMode = "rebase" | "merge";

export async function integrate(
	ctx: ArbContext,
	mode: IntegrateMode,
	options: {
		fetch?: boolean;
		yes?: boolean;
		dryRun?: boolean;
		retarget?: string | boolean;
		autostash?: boolean;
		verbose?: boolean;
		graph?: boolean;
		where?: string;
	},
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
	const where = resolveWhereFilter(options);

	// Resolve remotes for all repos
	const cache = new GitCache();
	await assertMinimumGitVersion(cache);
	const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);

	// Phase 2: fetch
	const shouldFetch = options.fetch !== false;
	const allFetchDirs = workspaceRepoDirs(wsDir);
	const selectedSet = new Set(selectedRepos);
	const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
	const repos = fetchDirs.map((d) => basename(d));

	const autostash = options.autostash === true;
	const assess = async (fetchFailed: string[]) => {
		const assessments = await Promise.all(
			selectedRepos.map(async (repo) => {
				const repoDir = `${wsDir}/${repo}`;
				const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo), cache);
				if (where) {
					const flags = computeFlags(status, branch);
					if (!repoMatchesWhere(flags, where)) return null;
				}
				return assessRepo(status, repoDir, branch, fetchFailed, retarget, retargetExplicit, autostash, cache, mode);
			}),
		);
		return assessments.filter((a): a is RepoAssessment => a !== null);
	};

	const postAssess = async (nextAssessments: RepoAssessment[]) => {
		await predictIntegrateConflicts(nextAssessments, mode);
		if (options.verbose) {
			await gatherIntegrateVerboseCommits(nextAssessments);
		}
		if (options.graph) {
			await gatherIntegrateGraphData(nextAssessments, !!options.verbose);
		}
	};

	const assessments = await runPlanFlow({
		shouldFetch,
		fetchDirs,
		reposForFetchReport: repos,
		remotesMap,
		assess,
		postAssess,
		formatPlan: (nextAssessments) => formatIntegratePlan(nextAssessments, mode, branch, options.verbose, options.graph),
		onPostFetch: () => cache.invalidateAfterFetch(),
	});

	// All-or-nothing check: when retarget is active, skipped repos block the entire retarget
	// (except repos with no base branch or where the retarget target simply doesn't exist on their remote)
	if (retarget) {
		const hasRetargetWork = assessments.some((a) => a.retargetTo || a.retargetBlocked);
		if (hasRetargetWork) {
			const blockedRepos = assessments.filter(
				(a) => a.outcome === "skip" && a.skipFlag !== "no-base-branch" && a.skipFlag !== "retarget-target-not-found",
			);
			if (blockedRepos.length > 0) {
				error("Cannot retarget: some repos are blocked. Fix these issues and retry:");
				for (const a of blockedRepos) {
					process.stderr.write(`  ${a.repo} — ${a.skipReason}\n`);
				}
				throw new ArbError("Cannot retarget: some repos are blocked.");
			}
			// Ensure at least one repo can actually retarget
			const hasActualRetargetWork = assessments.some((a) => a.retargetTo);
			if (!hasActualRetargetWork) {
				const notFoundRepos = assessments.filter((a) => a.skipFlag === "retarget-target-not-found");
				error("Cannot retarget: target branch not found on any repo.");
				for (const a of notFoundRepos) {
					process.stderr.write(`  ${a.repo} — ${a.skipReason}\n`);
				}
				throw new ArbError("Cannot retarget: target branch not found on any repo.");
			}
		}
	}
	const retargetConfigTarget = retarget ? resolveRetargetConfigTarget(assessments) : null;

	// Phase 4: confirm
	const willOperate = assessments.filter((a) => a.outcome === "will-operate");
	const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
	const skipped = assessments.filter((a) => a.outcome === "skip");

	if (willOperate.length === 0) {
		await maybeWriteRetargetConfig({
			dryRun: options.dryRun,
			wsDir,
			branch,
			assessments,
			retargetConfigTarget,
			cache,
		});
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
			const n = a.retargetReplayCount ?? a.ahead;
			const progressMsg =
				a.retargetReason === "branch-merged"
					? `rebasing ${n} new ${n === 1 ? "commit" : "commits"} onto ${ref} (merged)`
					: `rebasing ${branch} onto ${ref} from ${a.retargetFrom} (retarget)`;
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
			if (a.retargetFrom && a.retargetReason === "branch-merged") {
				const n = a.retargetReplayCount ?? a.ahead;
				doneMsg = `rebased ${n} new ${n === 1 ? "commit" : "commits"} onto ${ref} (merged)`;
			} else if (a.retargetFrom) {
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
	const subcommand = mode === "rebase" ? ("rebase" as const) : ("merge" as const);
	const conflictNodes = buildConflictReport(
		conflicted.map((c) => ({
			repo: c.assessment.repo,
			stdout: c.stdout,
			stderr: c.stderr,
			subcommand,
		})),
	);

	// Stash pop failure report
	const stashNodes = buildStashPopFailureReport(stashPopFailed, mode === "rebase" ? "Rebase" : "Merge");

	const reportCtx = { tty: isTTY() };
	if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));
	if (stashNodes.length > 0) process.stderr.write(render(stashNodes, reportCtx));

	// Update config after successful retarget (skip branch-merged replays — base doesn't change)
	await maybeWriteRetargetConfig({
		dryRun: options.dryRun,
		wsDir,
		branch,
		assessments,
		retargetConfigTarget,
		cache,
		hasConflicts: conflicted.length > 0,
	});

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
	finishSummary(parts, conflicted.length > 0 || stashPopFailed.length > 0);
}

export function resolveRetargetConfigTarget(assessments: RepoAssessment[]): string | null {
	const retargetTargets = [
		...new Set(
			assessments
				.filter((a) => a.retargetTo && a.retargetReason !== "branch-merged")
				.map((a) => a.retargetTo as string),
		),
	];
	if (retargetTargets.length === 0) return null;
	if (retargetTargets.length > 1) {
		const targets = retargetTargets.sort().join(", ");
		throw new ArbError(`Cannot retarget: repos disagree on target base (${targets}).`);
	}
	return retargetTargets[0] ?? null;
}

export async function maybeWriteRetargetConfig(options: {
	dryRun?: boolean;
	wsDir: string;
	branch: string;
	assessments: RepoAssessment[];
	retargetConfigTarget: string | null;
	cache: Pick<GitCache, "getDefaultBranch">;
	hasConflicts?: boolean;
}): Promise<boolean> {
	if (options.dryRun) return false;
	if (options.hasConflicts) return false;
	if (!options.retargetConfigTarget) return false;
	const { wsDir, branch, assessments, retargetConfigTarget, cache } = options;
	const firstRetarget = assessments.find(
		(a) => a.retargetTo === retargetConfigTarget && a.retargetReason !== "branch-merged",
	);
	if (!firstRetarget) return false;
	const configFile = `${wsDir}/.arbws/config`;
	const wb = await workspaceBranch(wsDir);
	const wsBranch = wb?.branch ?? branch;
	// Resolve the repo's default branch to check if retargetTo matches
	// If retargeting to the default branch, remove the base key
	// If retargeting to a non-default branch, set it as the new base
	const repoDefault = await cache.getDefaultBranch(firstRetarget.repoDir, firstRetarget.baseRemote);
	if (repoDefault && retargetConfigTarget !== repoDefault) {
		writeConfig(configFile, wsBranch, retargetConfigTarget);
	} else {
		writeConfig(configFile, wsBranch, undefined);
	}
	return true;
}

// ── Semantic intermediate for integrate plan ──

export interface IntegrateActionDesc {
	kind: "retarget-merged" | "retarget-config" | "rebase" | "merge";
	baseRef: string;
	branch: string;
	retargetFrom?: string;
	replayCount?: number;
	skipCount?: number;
	diff?: { behind: number; ahead: number; matchedCount?: number };
	mergeType?: "fast-forward" | "three-way";
	conflictRisk: "will-conflict" | "likely" | "unlikely" | "no-conflict" | null;
	stash: "none" | "autostash" | "pop-conflict-likely" | "pop-conflict-unlikely";
	warning?: string;
	headSha?: string;
}

function classifyStash(a: RepoAssessment): IntegrateActionDesc["stash"] {
	if (!a.needsStash) return "none";
	if (a.stashPopConflictFiles && a.stashPopConflictFiles.length > 0) return "pop-conflict-likely";
	if (a.stashPopConflictFiles) return "pop-conflict-unlikely";
	return "autostash";
}

function classifyConflictRisk(
	prediction: RepoAssessment["conflictPrediction"],
	mode: IntegrateMode,
): IntegrateActionDesc["conflictRisk"] {
	if (prediction === "conflict") return mode === "merge" ? "will-conflict" : "likely";
	if (prediction === "clean") return mode === "merge" ? "no-conflict" : "unlikely";
	if (prediction === "no-conflict") return "no-conflict";
	return null;
}

export function describeIntegrateAction(a: RepoAssessment, mode: IntegrateMode, branch: string): IntegrateActionDesc {
	const baseRef = `${a.baseRemote}/${a.baseBranch}`;
	const stash = classifyStash(a);

	if (a.retargetFrom) {
		if (a.retargetReason === "branch-merged") {
			return {
				kind: "retarget-merged",
				baseRef,
				branch,
				replayCount: a.retargetReplayCount ?? a.ahead,
				skipCount: a.retargetAlreadyOnTarget,
				conflictRisk: null,
				stash,
				warning: a.retargetWarning,
				headSha: a.headSha,
			};
		}
		return {
			kind: "retarget-config",
			baseRef,
			branch,
			retargetFrom: a.retargetFrom,
			replayCount: a.retargetReplayCount,
			skipCount: a.retargetAlreadyOnTarget,
			conflictRisk: null,
			stash,
			warning: a.retargetWarning,
			headSha: a.headSha,
		};
	}

	return {
		kind: mode,
		baseRef,
		branch,
		diff: { behind: a.behind, ahead: a.ahead, matchedCount: a.matchedCount },
		mergeType: mode === "merge" ? (a.ahead === 0 ? "fast-forward" : "three-way") : undefined,
		conflictRisk: classifyConflictRisk(a.conflictPrediction, mode),
		stash,
		headSha: a.headSha,
	};
}

export function integrateActionCell(desc: IntegrateActionDesc): Cell {
	let result: Cell;

	if (desc.kind === "retarget-merged") {
		const n = desc.replayCount ?? 0;
		const merged = desc.skipCount ?? 0;
		const commitWord = n === 1 ? "commit" : "commits";
		let text = `rebase onto ${desc.baseRef} (merged) \u2014 rebase ${n} new ${commitWord}`;
		if (merged > 0) text += `, skip ${merged} already merged`;
		result = cell(text);
	} else if (desc.kind === "retarget-config") {
		let text = `rebase onto ${desc.baseRef} from ${desc.retargetFrom} (retarget)`;
		if (desc.skipCount != null && desc.skipCount > 0) {
			const total = (desc.replayCount ?? 0) + desc.skipCount;
			text += ` \u2014 ${total} local, ${desc.skipCount} already on target, ${desc.replayCount ?? 0} to rebase`;
		} else if (desc.replayCount != null && desc.replayCount > 0) {
			text += ` \u2014 ${desc.replayCount} to rebase`;
		}
		result = cell(text);
	} else {
		const diff = desc.diff;
		const behindStr =
			diff && diff.behind > 0
				? diff.matchedCount && diff.matchedCount > 0
					? `${diff.behind} behind (${diff.matchedCount} same, ${diff.behind - diff.matchedCount} new)`
					: `${diff.behind} behind`
				: "";
		const diffParts = [diff && diff.behind > 0 && behindStr, diff && diff.ahead > 0 && `${diff.ahead} ahead`]
			.filter(Boolean)
			.join(", ");
		const diffStr = diffParts ? ` \u2014 ${diffParts}` : "";

		const mergeType = desc.mergeType ? ` (${desc.mergeType})` : "";
		const action =
			desc.kind === "rebase"
				? `rebase ${desc.branch} onto ${desc.baseRef}`
				: `merge ${desc.baseRef} into ${desc.branch}${mergeType}`;

		result = cell(`${action}${diffStr}`);
	}

	// Conflict risk
	if (desc.conflictRisk) {
		const labels = {
			"will-conflict": "will conflict",
			likely: "conflict likely",
			unlikely: "conflict unlikely",
			"no-conflict": "no conflict",
		} as const;
		const isAttention = desc.conflictRisk === "will-conflict" || desc.conflictRisk === "likely";
		result = suffix(result, ` (${labels[desc.conflictRisk]})`, isAttention ? "attention" : "default");
	}

	// Retarget warning
	if (desc.warning) {
		result = suffix(result, ` (${desc.warning})`, "attention");
	}

	// Stash hint
	if (desc.stash === "autostash") {
		result = suffix(result, " (autostash)");
	} else if (desc.stash === "pop-conflict-likely") {
		result = suffix(result, " (autostash, stash pop conflict likely)", "attention");
	} else if (desc.stash === "pop-conflict-unlikely") {
		result = suffix(result, " (autostash, stash pop conflict unlikely)");
	}

	// HEAD sha
	if (desc.headSha) {
		result = suffix(result, `  (HEAD ${desc.headSha})`, "muted");
	}

	return result;
}

export function buildIntegratePlanNodes(
	assessments: RepoAssessment[],
	mode: IntegrateMode,
	branch: string,
	verbose?: boolean,
	graph?: boolean,
): OutputNode[] {
	const nodes: OutputNode[] = [{ kind: "gap" }];

	const rows = assessments.map((a) => {
		let actionCell: Cell;
		if (a.outcome === "will-operate") {
			actionCell = integrateActionCell(describeIntegrateAction(a, mode, branch));
		} else if (a.outcome === "up-to-date") {
			actionCell = upToDateCell();
		} else {
			actionCell = skipCell(a.skipReason ?? "", a.skipFlag);
		}

		let afterRow: OutputNode[] | undefined;
		if (a.outcome === "will-operate") {
			if (graph) {
				const graphText = formatBranchGraph(a, branch, !!verbose);
				if (graphText) afterRow = [{ kind: "rawText", text: graphText }];
			} else if (verbose && a.commits && a.commits.length > 0) {
				const label = `Incoming from ${a.baseRemote}/${a.baseBranch}:`;
				afterRow = verboseCommitsToNodes(a.commits, a.totalCommits ?? a.commits.length, label, {
					diffStats: a.diffStats,
					conflictCommits: a.conflictCommits,
				});
			}
		}

		return {
			cells: { repo: cell(a.repo), action: actionCell },
			afterRow,
		};
	});

	nodes.push({
		kind: "table",
		columns: [
			{ header: "REPO", key: "repo" },
			{ header: "ACTION", key: "action" },
		],
		rows,
	});

	// Shallow clone warnings
	const shallowRepos = assessments.filter((a) => a.shallow);
	for (const a of shallowRepos) {
		nodes.push({
			kind: "message",
			level: "attention",
			text: `${a.repo} is a shallow clone; ahead/behind counts may be inaccurate and ${mode} may fail if the merge base is beyond the shallow boundary`,
		});
	}

	nodes.push({ kind: "gap" });
	return nodes;
}

export function formatIntegratePlan(
	assessments: RepoAssessment[],
	mode: IntegrateMode,
	branch: string,
	verbose?: boolean,
	graph?: boolean,
): string {
	const nodes = buildIntegratePlanNodes(assessments, mode, branch, verbose, graph);
	const envCols = Number(process.env.COLUMNS);
	const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
	const ctx: RenderContext = { tty: isTTY(), terminalWidth: termCols > 0 ? termCols : undefined };
	return render(nodes, ctx);
}

async function predictIntegrateConflicts(assessments: RepoAssessment[], mode: IntegrateMode): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-operate")
			.map(async (a) => {
				const ref = `${a.baseRemote}/${a.baseBranch}`;
				if (!a.retargetFrom && a.ahead > 0 && a.behind > 0) {
					const prediction = await predictMergeConflict(a.repoDir, ref);
					a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
					// Per-commit conflict detail for rebase mode
					if (prediction?.hasConflict && mode === "rebase") {
						const conflictCommits = await predictRebaseConflictCommits(a.repoDir, ref);
						if (conflictCommits.length > 0) a.conflictCommits = conflictCommits;
					}
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

async function gatherIntegrateVerboseCommits(assessments: RepoAssessment[]): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-operate")
			.map(async (a) => {
				const ref = `${a.baseRemote}/${a.baseBranch}`;
				const incomingCommits = await getCommitsBetweenFull(a.repoDir, "HEAD", ref);
				const total = incomingCommits.length;

				// When diverged, match incoming commits against local commits
				let rebaseMap: Map<string, string> | undefined;
				let squashMatch: { incomingHash: string; localHashes: string[] } | undefined;
				let localHashToShort: Map<string, string> | undefined;

				if (a.ahead > 0 && a.behind > 0) {
					const matchResult = await matchDivergedCommits(a.repoDir, ref);
					if (matchResult.rebaseMatches.size > 0) rebaseMap = matchResult.rebaseMatches;
					if (matchResult.squashMatch) squashMatch = matchResult.squashMatch;

					if (rebaseMap || squashMatch) {
						const localCommits = await getCommitsBetweenFull(a.repoDir, ref, "HEAD");
						localHashToShort = new Map(localCommits.map((c) => [c.fullHash, c.shortHash]));
					}
				}

				let matchedCount = 0;
				a.commits = incomingCommits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => {
					const entry: NonNullable<RepoAssessment["commits"]>[number] = {
						shortHash: c.shortHash,
						subject: c.subject,
					};
					if (rebaseMap?.has(c.fullHash)) {
						const localHash = rebaseMap.get(c.fullHash) ?? c.fullHash;
						entry.rebaseOf = localHashToShort?.get(localHash) ?? localHash.slice(0, 7);
						matchedCount++;
					} else if (squashMatch && c.fullHash === squashMatch.incomingHash) {
						entry.squashOf = squashMatch.localHashes.map((h) => localHashToShort?.get(h) ?? h.slice(0, 7));
						matchedCount++;
					}
					return entry;
				});
				// Count matches in commits beyond the display limit too
				for (const c of incomingCommits.slice(VERBOSE_COMMIT_LIMIT)) {
					if (rebaseMap?.has(c.fullHash)) matchedCount++;
					else if (squashMatch && c.fullHash === squashMatch.incomingHash) matchedCount++;
				}
				a.totalCommits = total;
				if (matchedCount > 0) a.matchedCount = matchedCount;

				// Diff stats
				a.diffStats = (await getDiffShortstat(a.repoDir, "HEAD", ref)) ?? undefined;
			}),
	);
}

async function gatherIntegrateGraphData(assessments: RepoAssessment[], verbose: boolean): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-operate")
			.map(async (a) => {
				// Resolve the ref used for merge-base and outgoing commits
				let mergeBaseRef: string;
				if (a.retargetFrom) {
					const oldBaseRemoteExists = await remoteBranchExists(a.repoDir, a.retargetFrom, a.baseRemote);
					mergeBaseRef = oldBaseRemoteExists ? `${a.baseRemote}/${a.retargetFrom}` : a.retargetFrom;
				} else {
					mergeBaseRef = `${a.baseRemote}/${a.baseBranch}`;
				}

				a.mergeBaseSha = (await getMergeBase(a.repoDir, "HEAD", mergeBaseRef)) ?? undefined;

				// Gather outgoing commits (feature branch side) when verbose + graph
				if (verbose && a.ahead > 0) {
					const commits = await getCommitsBetweenFull(a.repoDir, mergeBaseRef, "HEAD");
					const total = commits.length;
					a.outgoingCommits = commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
						shortHash: c.shortHash,
						subject: c.subject,
					}));
					a.totalOutgoingCommits = total;
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
		return { ...base, skipReason: "fetch failed", skipFlag: "fetch-failed" };
	}

	// Operation in progress
	if (status.operation !== null) {
		return { ...base, skipReason: `${status.operation} in progress`, skipFlag: "operation-in-progress" };
	}

	// Branch check — detached or drifted
	if (status.identity.headMode.kind === "detached") {
		return { ...base, skipReason: "HEAD is detached", skipFlag: "detached-head" };
	}
	if (status.identity.headMode.branch !== branch) {
		return {
			...base,
			skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}`,
			skipFlag: "drifted",
		};
	}

	// Dirty check
	const flags = computeFlags(status, branch);
	if (flags.isDirty) {
		if (!autostash) {
			return { ...base, skipReason: "uncommitted changes (use --autostash)", skipFlag: "dirty" };
		}
		// Only stash if there are staged or modified files (not untracked-only)
		if (status.local.staged > 0 || status.local.modified > 0) {
			base.needsStash = true;
		}
	}

	// No base branch resolved
	if (status.base === null) {
		return { ...base, skipReason: "no base branch", skipFlag: "no-base-branch" };
	}

	// After this point, status.base is guaranteed non-null.
	// Remote repos must have a resolved base remote to proceed.
	if (!status.base.remote) {
		return { ...base, skipReason: "no base remote", skipFlag: "no-base-remote" };
	}
	base.baseRemote = status.base.remote;

	// Feature branch already merged into base (merge or squash)
	if (status.base.mergedIntoBase != null) {
		const strategy = status.base.mergedIntoBase === "squash" ? "squash-merged" : "merged";
		return {
			...base,
			skipReason: `already ${strategy} into ${status.base.ref}`,
			skipFlag: "already-merged",
			baseBranch: status.base.ref,
			behind: status.base.behind,
			ahead: status.base.ahead,
		};
	}

	// Stacked base branch has been merged into default
	if (status.base.baseMergedIntoDefault != null) {
		return {
			...base,
			skipReason: `base branch ${status.base.configuredRef ?? status.base.ref} was merged into default (use --retarget)`,
			skipFlag: "base-merged-into-default",
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
	retarget: boolean,
	retargetExplicit: string | null,
	autostash: boolean,
	cache: GitCache,
	mode: IntegrateMode,
): Promise<RepoAssessment> {
	const headSha = await getShortHead(repoDir);
	const classified = classifyRepo(status, repoDir, branch, fetchFailed, autostash, headSha);

	// Hard skips from basic checks (steps 1–7) — retarget can't help.
	// Only the baseMergedIntoDefault skip should pass through to retarget logic.
	// Also allow already-merged with new commits to pass through for replay recovery.
	const base = status.base;
	const isMergedNewWork =
		classified.skipFlag === "already-merged" && base?.newCommitsAfterMerge && base.newCommitsAfterMerge > 0;
	if (classified.outcome === "skip" && classified.skipFlag !== "base-merged-into-default" && !isMergedNewWork) {
		return classified;
	}

	const baseRemote = classified.baseRemote;

	// Merged branch with new commits — in merge mode, just do a normal merge;
	// in rebase mode, replay only the new commits via rebase --onto
	if (isMergedNewWork && base && mode === "merge") {
		if (base.behind === 0) {
			return { ...classified, outcome: "up-to-date", baseBranch: base.ref, behind: 0, ahead: base.ahead };
		}
		return {
			...classified,
			outcome: "will-operate",
			baseBranch: base.ref,
			behind: base.behind,
			ahead: base.ahead,
		};
	}
	if (isMergedNewWork && base) {
		const n = base.newCommitsAfterMerge ?? 0;
		const boundaryResult = await git(repoDir, "rev-parse", `HEAD~${n}`);
		if (boundaryResult.exitCode === 0) {
			const boundarySha = boundaryResult.stdout.trim();
			return {
				...classified,
				outcome: "will-operate",
				baseBranch: base.ref,
				behind: base.behind,
				ahead: n,
				retargetFrom: boundarySha,
				retargetTo: base.ref,
				retargetReplayCount: n,
				retargetAlreadyOnTarget: Math.max(0, base.ahead - n),
				retargetReason: "branch-merged",
			};
		}
	}

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
				skipFlag: "retarget-target-not-found",
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
				skipFlag: "retarget-base-not-found",
				retargetBlocked: true,
			};
		}

		// Per-repo merge detection
		const targetRef = `${baseRemote}/${retargetExplicit}`;
		const oldBaseRef = oldBaseRemoteExists ? `${baseRemote}/${oldBaseName}` : oldBaseName;
		let retargetWarning: string | undefined;
		const mergeDetection = await detectBranchMerged(repoDir, targetRef, 200, oldBaseRef);
		if (mergeDetection === null) {
			retargetWarning = `base branch ${oldBaseName} may not be merged`;
		}

		// Up-to-date check: already on target and 0 behind
		if (base?.ref === retargetExplicit && base?.behind === 0) {
			return {
				...classified,
				outcome: "up-to-date",
				baseBranch: retargetExplicit,
				retargetFrom: oldBaseName,
				retargetTo: retargetExplicit,
				retargetWarning,
				retargetReason: "base-merged",
				behind: base.behind,
				ahead: base.ahead,
			};
		}

		// Retarget replay analysis
		const replayAnalysis = await analyzeRetargetReplay(repoDir, oldBaseRef, targetRef);

		return {
			...classified,
			outcome: "will-operate",
			baseBranch: retargetExplicit,
			retargetFrom: oldBaseName,
			retargetTo: retargetExplicit,
			retargetWarning,
			retargetReason: "base-merged",
			behind: base?.behind ?? 0,
			ahead: base?.ahead ?? 0,
			...(replayAnalysis && {
				retargetReplayCount: replayAnalysis.toReplay,
				retargetAlreadyOnTarget: replayAnalysis.alreadyOnTarget,
			}),
		};
	}

	// Diverged branch where some/all local commits are already represented on target base.
	// When contiguous, replay only the top suffix; when none remain, treat as up-to-date.
	// Explicit retarget takes precedence over this optimization.
	if (
		mode === "rebase" &&
		retargetExplicit === null &&
		classified.outcome === "will-operate" &&
		base?.replayPlan?.contiguous
	) {
		const replayPlan = base.replayPlan;
		if (replayPlan.alreadyOnTarget > 0 && replayPlan.toReplay === 0) {
			return { ...classified, outcome: "up-to-date", baseBranch: base.ref, behind: 0, ahead: base.ahead };
		}
		if (replayPlan.alreadyOnTarget > 0 && replayPlan.toReplay > 0) {
			return {
				...classified,
				outcome: "will-operate",
				baseBranch: base.ref,
				behind: base.behind,
				ahead: replayPlan.toReplay,
				retargetFrom: `HEAD~${replayPlan.toReplay}`,
				retargetTo: base.ref,
				retargetReplayCount: replayPlan.toReplay,
				retargetAlreadyOnTarget: replayPlan.alreadyOnTarget,
				retargetReason: "branch-merged",
			};
		}
	}

	// Stacked base branch has been merged into default (auto-detect)
	if (base?.baseMergedIntoDefault != null) {
		if (!retarget) {
			return classified;
		}

		// Resolve the true default branch for retarget
		const trueDefault = await cache.getDefaultBranch(repoDir, baseRemote);
		if (!trueDefault) {
			return {
				...classified,
				outcome: "skip",
				skipReason: "cannot resolve default branch for retarget",
				skipFlag: "retarget-no-default",
			};
		}

		const oldBaseNameForReplay = base.configuredRef ?? base.ref;

		// For squash-merged repos, check if already retargeted
		if (base.baseMergedIntoDefault === "squash") {
			const defaultRef = `${baseRemote}/${trueDefault}`;
			const alreadyOnDefault = await git(repoDir, "merge-base", "--is-ancestor", defaultRef, "HEAD");
			if (alreadyOnDefault.exitCode === 0) {
				return {
					...classified,
					outcome: "up-to-date",
					baseBranch: trueDefault,
					retargetFrom: oldBaseNameForReplay,
					retargetTo: trueDefault,
					retargetReason: "base-merged",
					behind: base.behind,
					ahead: base.ahead,
				};
			}
		}

		// Retarget replay analysis
		const oldBaseRemoteRefExists = await remoteBranchExists(repoDir, oldBaseNameForReplay, baseRemote);
		const oldBaseRefForReplay = oldBaseRemoteRefExists ? `${baseRemote}/${oldBaseNameForReplay}` : oldBaseNameForReplay;
		const newBaseRefForReplay = `${baseRemote}/${trueDefault}`;
		const replayAnalysis = await analyzeRetargetReplay(repoDir, oldBaseRefForReplay, newBaseRefForReplay);

		return {
			...classified,
			outcome: "will-operate",
			baseBranch: trueDefault,
			retargetFrom: base.configuredRef ?? base.ref,
			retargetTo: trueDefault,
			retargetReason: "base-merged",
			behind: base.behind,
			ahead: base.ahead,
			...(replayAnalysis && {
				retargetReplayCount: replayAnalysis.toReplay,
				retargetAlreadyOnTarget: replayAnalysis.alreadyOnTarget,
			}),
		};
	}

	return classified;
}
