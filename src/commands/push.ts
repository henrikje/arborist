import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { ArbError } from "../lib/errors";
import { getCommitsBetweenFull, getShortHead, git } from "../lib/git";
import { GitCache } from "../lib/git-cache";
import { confirmOrExit, runPlanFlow } from "../lib/mutation-flow";
import { dim, dryRunNotice, finishSummary, info, inlineResult, inlineStart, plural, red, yellow } from "../lib/output";
import { formatSkipLine, formatUpToDateLine } from "../lib/plan-format";
import type { RepoRemotes } from "../lib/remotes";
import { resolveRepoSelection, workspaceRepoDirs } from "../lib/repos";
import type { SkipFlag } from "../lib/skip-flags";
import { type RepoStatus, gatherRepoStatus } from "../lib/status";
import { VERBOSE_COMMIT_LIMIT, formatVerboseCommits } from "../lib/status-verbose";
import { readNamesFromStdin } from "../lib/stdin";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export interface PushAssessment {
	repo: string;
	repoDir: string;
	outcome: "will-push" | "will-force-push" | "up-to-date" | "skip";
	skipReason?: string;
	skipFlag?: SkipFlag;
	ahead: number;
	behind: number;
	rebased: number;
	branch: string;
	shareRemote: string;
	newBranch: boolean;
	headSha: string;
	recreate: boolean;
	behindBase: number;
	commits?: { shortHash: string; subject: string }[];
	totalCommits?: number;
}

export function registerPushCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("push [repos...]")
		.option("-f, --force", "Force push with lease")
		.option("-F, --fetch", "Fetch from all remotes before push (default)")
		.option("--no-fetch", "Skip fetching before push")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("-v, --verbose", "Show outgoing commits in the plan")
		.summary("Push the feature branch to the share remote")
		.description(
			"Fetches all repos, then pushes the feature branch for all repos, or only the named repos. Pushes to the share remote (origin by default, or as configured for fork workflows). Sets up tracking on first push. Shows a plan and asks for confirmation before pushing. The plan highlights repos that are behind the base branch, with a hint to rebase before pushing. Skips repos whose branches have been merged into the base branch. If a remote branch was deleted after merge, use --force to recreate it. Use --force after rebase or amend to force push with lease. Use --verbose to show the outgoing commits for each repo in the plan. Use -F/--fetch to fetch explicitly (default); use --no-fetch to skip fetching when refs are known to be fresh.",
		)
		.action(
			async (
				repoArgs: string[],
				options: { force?: boolean; fetch?: boolean; yes?: boolean; dryRun?: boolean; verbose?: boolean },
			) => {
				const ctx = getCtx();
				const { wsDir, workspace } = requireWorkspace(ctx);
				const branch = await requireBranch(wsDir, workspace);

				let repoNames = repoArgs;
				if (repoNames.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) repoNames = stdinNames;
				}
				const selectedRepos = resolveRepoSelection(wsDir, repoNames);
				const cache = new GitCache();
				const remotesMap = await cache.resolveRemotesMap(selectedRepos, ctx.reposDir);
				const configBase = configGet(`${wsDir}/.arbws/config`, "base");

				const shouldFetch = options.fetch !== false;
				const allFetchDirs = workspaceRepoDirs(wsDir);
				const selectedSet = new Set(selectedRepos);
				const fetchDirs = allFetchDirs.filter((dir) => selectedSet.has(basename(dir)));
				const allRepos = fetchDirs.map((d) => basename(d));

				const assess = async (_fetchFailed: string[]) => {
					const assessments = await Promise.all(
						selectedRepos.map(async (repo) => {
							const repoDir = `${wsDir}/${repo}`;
							const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo), cache);
							const headSha = await getShortHead(repoDir);
							return assessPushRepo(status, repoDir, branch, headSha, { force: options.force });
						}),
					);
					for (const a of assessments) {
						if (a.outcome === "will-force-push" && !options.force) {
							a.outcome = "skip";
							const rebasedHint = a.rebased > 0 ? `, ${a.rebased} rebased` : "";
							a.skipReason = `diverged from ${a.shareRemote}${rebasedHint} (use --force)`;
							a.skipFlag = "diverged";
						}
					}
					return assessments;
				};

				const postAssess = options.verbose
					? (nextAssessments: PushAssessment[]) => gatherPushVerboseCommits(nextAssessments, remotesMap, branch)
					: undefined;

				const assessments = await runPlanFlow({
					shouldFetch,
					fetchDirs,
					reposForFetchReport: allRepos,
					remotesMap,
					assess,
					postAssess,
					formatPlan: (nextAssessments) => formatPushPlan(nextAssessments, remotesMap, options.verbose),
					onPostFetch: () => cache.invalidateAfterFetch(),
				});

				const willPush = assessments.filter((a) => a.outcome === "will-push" || a.outcome === "will-force-push");
				const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
				const skipped = assessments.filter((a) => a.outcome === "skip");

				if (willPush.length === 0) {
					info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
					return;
				}

				if (options.dryRun) {
					dryRunNotice();
					return;
				}

				// Phase 3: confirm
				await confirmOrExit({
					yes: options.yes,
					message: `Push ${plural(willPush.length, "repo")}?`,
				});

				process.stderr.write("\n");

				// Phase 4: execute
				let pushOk = 0;

				for (const a of willPush) {
					inlineStart(a.repo, "pushing");
					const pushArgs =
						a.outcome === "will-force-push"
							? ["push", "-u", "--force-with-lease", a.shareRemote, a.branch]
							: ["push", "-u", a.shareRemote, a.branch];
					const pushResult = await git(a.repoDir, ...pushArgs);
					if (pushResult.exitCode === 0) {
						inlineResult(a.repo, `pushed ${plural(a.ahead, "commit")}`);
						pushOk++;
					} else {
						inlineResult(a.repo, red("failed"));
						process.stderr.write("\n");
						const errText = pushResult.stderr.trim();
						if (errText) {
							for (const line of errText.split("\n")) {
								process.stderr.write(`  ${line}\n`);
							}
						}
						process.stderr.write("\n  To resolve, check the error above, then re-run 'arb push' to continue.\n");
						throw new ArbError(`Push failed for ${a.repo}`);
					}
				}

				// Phase 5: summary
				process.stderr.write("\n");
				const parts = [`Pushed ${plural(pushOk, "repo")}`];
				if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
				if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
				finishSummary(parts, false);
			},
		);
}

export function formatPushPlan(
	assessments: PushAssessment[],
	remotesMap: Map<string, RepoRemotes>,
	verbose?: boolean,
): string {
	let out = "\n";
	for (const a of assessments) {
		const remotes = remotesMap.get(a.repo);
		const forkSuffix = remotes && remotes.base !== remotes.share ? ` → ${a.shareRemote}` : "";
		const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
		const behindBaseSuffix = a.behindBase > 0 ? ` ${yellow(`(${a.behindBase} behind base)`)}` : "";
		if (a.outcome === "will-push") {
			const newBranchSuffix = a.recreate ? " (recreate)" : a.newBranch ? " (new branch)" : "";
			out += `  ${a.repo}   ${plural(a.ahead, "commit")} to push${newBranchSuffix}${behindBaseSuffix}${forkSuffix}${headStr}\n`;
		} else if (a.outcome === "will-force-push") {
			if (a.rebased > 0) {
				const newCount = a.ahead - a.rebased;
				const desc = newCount > 0 ? `${newCount} new + ${a.rebased} rebased` : `${a.rebased} rebased`;
				out += `  ${a.repo}   ${desc} to push (force)${behindBaseSuffix}${headStr}\n`;
			} else {
				out += `  ${a.repo}   ${plural(a.ahead, "commit")} to push (force — ${a.behind} behind ${a.shareRemote})${behindBaseSuffix}${headStr}\n`;
			}
		} else if (a.outcome === "up-to-date") {
			out += formatUpToDateLine(a.repo);
		} else {
			out += formatSkipLine(a.repo, a.skipReason ?? "", a.skipFlag);
		}
		if (
			verbose &&
			(a.outcome === "will-push" || a.outcome === "will-force-push") &&
			a.commits &&
			a.commits.length > 0
		) {
			const label = `Outgoing to ${a.shareRemote}:`;
			out += formatVerboseCommits(a.commits, a.totalCommits ?? a.commits.length, label);
		}
	}

	const behindBaseCount = assessments.filter(
		(a) => (a.outcome === "will-push" || a.outcome === "will-force-push") && a.behindBase > 0,
	).length;
	if (behindBaseCount > 0) {
		out += `  ${dim(`hint: ${plural(behindBaseCount, "repo")} behind base — consider 'arb rebase' before pushing`)}\n`;
	}

	out += "\n";
	return out;
}

async function gatherPushVerboseCommits(
	assessments: PushAssessment[],
	remotesMap: Map<string, RepoRemotes>,
	branch: string,
): Promise<void> {
	await Promise.all(
		assessments
			.filter((a) => a.outcome === "will-push" || a.outcome === "will-force-push")
			.map(async (a) => {
				const shareRemote = remotesMap.get(a.repo)?.share;
				if (!shareRemote) return;
				// For new branches or recreated branches, use the base remote's base branch
				const ref =
					a.newBranch || a.recreate
						? `${remotesMap.get(a.repo)?.base ?? shareRemote}/HEAD`
						: `${shareRemote}/${branch}`;
				const commits = await getCommitsBetweenFull(a.repoDir, ref, "HEAD");
				const total = commits.length;
				a.commits = commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
					shortHash: c.shortHash,
					subject: c.subject,
				}));
				a.totalCommits = total;
			}),
	);
}

export function assessPushRepo(
	status: RepoStatus,
	repoDir: string,
	branch: string,
	headSha: string,
	options?: { force?: boolean },
): PushAssessment {
	const behindBase = status.base?.behind ?? 0;

	const base: PushAssessment = {
		repo: status.name,
		repoDir,
		outcome: "skip",
		ahead: 0,
		behind: 0,
		rebased: 0,
		branch,
		shareRemote: status.share.remote,
		newBranch: false,
		headSha,
		recreate: false,
		behindBase,
	};

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

	// Base branch merged into default — retarget before pushing
	if (status.base?.baseMergedIntoDefault != null) {
		const baseName = status.base.configuredRef ?? status.base.ref;
		return {
			...base,
			skipReason: `base branch ${baseName} was merged into default (retarget first with 'arb rebase --retarget')`,
			skipFlag: "base-merged-into-default",
		};
	}

	// Remote branch was deleted (gone)
	if (status.share.refMode === "gone") {
		if (status.base?.mergedIntoBase != null && !options?.force) {
			return {
				...base,
				skipReason: `already merged into ${status.base.ref} (use --force to recreate)`,
				skipFlag: "already-merged",
			};
		}
		const ahead = status.base?.ahead ?? 1;
		return { ...base, outcome: "will-push", ahead, recreate: true };
	}

	// Merged but not gone — nothing useful to push unless forced
	if (status.base?.mergedIntoBase != null && !options?.force) {
		return { ...base, skipReason: `already merged into ${status.base.ref} (use --force)`, skipFlag: "already-merged" };
	}

	// Never pushed (noRef) — new branch
	if (status.share.refMode === "noRef") {
		const ahead = status.base?.ahead ?? 1;
		if (ahead === 0) {
			return { ...base, outcome: "skip", skipReason: "no commits to push", skipFlag: "no-commits" };
		}
		return { ...base, outcome: "will-push", ahead, newBranch: true };
	}

	// Has push/pull counts — compare
	const toPush = status.share.toPush ?? 0;
	const toPull = status.share.toPull ?? 0;

	if (toPush === 0 && toPull === 0) {
		return { ...base, outcome: "up-to-date" };
	}

	if (toPush === 0 && toPull > 0) {
		return {
			...base,
			outcome: "skip",
			skipReason: `behind ${status.share.remote} (pull first?)`,
			skipFlag: "behind-remote",
			behind: toPull,
		};
	}

	if (toPush > 0 && toPull > 0) {
		const rebased = status.share.rebased ?? 0;
		return { ...base, outcome: "will-force-push", ahead: toPush, behind: toPull, rebased };
	}

	return { ...base, outcome: "will-push", ahead: toPush };
}
