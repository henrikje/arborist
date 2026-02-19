import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { getShortHead } from "../lib/git";
import {
	clearLines,
	countLines,
	dim,
	error,
	info,
	inlineResult,
	inlineStart,
	plural,
	red,
	success,
	yellow,
} from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import type { RepoRemotes } from "../lib/remotes";
import { resolveRemotesMap } from "../lib/remotes";
import { classifyRepos, resolveRepoSelection } from "../lib/repos";
import { type RepoStatus, gatherRepoStatus } from "../lib/status";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

interface PushAssessment {
	repo: string;
	repoDir: string;
	outcome: "will-push" | "will-force-push" | "up-to-date" | "skip";
	skipReason?: string;
	ahead: number;
	behind: number;
	branch: string;
	shareRemote: string;
	newBranch: boolean;
	headSha: string;
	recreate: boolean;
}

export function registerPushCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("push [repos...]")
		.option("-f, --force", "Force push with lease (implies --yes)")
		.option("--no-fetch", "Skip fetching before push")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.summary("Push the feature branch to the share remote")
		.description(
			"Fetches all repos, then pushes the feature branch for all repos, or only the named repos. Pushes to the share remote (origin by default, or as configured for fork workflows). Sets up tracking on first push. Shows a plan and asks for confirmation before pushing. If a remote branch was deleted (e.g. after merging a PR), the push recreates it. Skips repos without a remote and repos where the remote branch has been deleted. Use --force after rebase or amend to force push with lease (implies --yes). Use --no-fetch to skip fetching when refs are known to be fresh.",
		)
		.action(
			async (repoArgs: string[], options: { force?: boolean; fetch?: boolean; yes?: boolean; dryRun?: boolean }) => {
				const ctx = getCtx();
				const { wsDir, workspace } = requireWorkspace(ctx);
				const branch = await requireBranch(wsDir, workspace);

				const selectedRepos = resolveRepoSelection(wsDir, repoArgs);
				const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);
				const configBase = configGet(`${wsDir}/.arbws/config`, "base");

				const shouldFetch = options.fetch !== false;
				const { repos: allRepos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
				const canTwoPhase = shouldFetch && fetchDirs.length > 0 && isTTY();

				const assess = async () => {
					const assessments: PushAssessment[] = [];
					for (const repo of selectedRepos) {
						const repoDir = `${wsDir}/${repo}`;
						const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, remotesMap.get(repo));
						assessments.push(await assessPushRepo(status, repoDir, branch));
					}
					for (const a of assessments) {
						if (a.outcome === "will-force-push" && !options.force) {
							a.outcome = "skip";
							a.skipReason = `diverged from ${a.shareRemote} (use --force)`;
						}
					}
					return assessments;
				};

				let assessments: PushAssessment[];

				if (canTwoPhase) {
					// Two-phase: render stale plan immediately, re-render after fetch
					const fetchPromise = parallelFetch(fetchDirs, undefined, remotesMap, { silent: true });

					assessments = await assess();
					const stalePlan = formatPushPlan(assessments, remotesMap);
					const fetchingLine = `${dim(`Fetching ${plural(fetchDirs.length, "repo")}...`)}\n`;
					const staleOutput = stalePlan + fetchingLine;
					process.stderr.write(staleOutput);

					const fetchResults = await fetchPromise;

					// Re-assess with fresh refs
					assessments = await assess();
					const freshPlan = formatPushPlan(assessments, remotesMap);
					clearLines(countLines(staleOutput));
					process.stderr.write(freshPlan);

					reportFetchFailures(allRepos, localRepos, fetchResults);
				} else if (shouldFetch && fetchDirs.length > 0) {
					// Fallback: fetch with visible progress, then assess
					const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
					reportFetchFailures(allRepos, localRepos, fetchResults);
					assessments = await assess();
					process.stderr.write(formatPushPlan(assessments, remotesMap));
				} else {
					// No fetch needed
					assessments = await assess();
					process.stderr.write(formatPushPlan(assessments, remotesMap));
				}

				const willPush = assessments.filter((a) => a.outcome === "will-push" || a.outcome === "will-force-push");
				const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
				const skipped = assessments.filter((a) => a.outcome === "skip");

				if (willPush.length === 0) {
					info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
					return;
				}

				if (options.dryRun) return;

				// Phase 3: confirm
				if (!options.yes && !options.force) {
					if (!isTTY()) {
						error("Not a terminal. Use --yes to skip confirmation.");
						process.exit(1);
					}
					const ok = await confirm(
						{
							message: `Push ${plural(willPush.length, "repo")}?`,
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

				// Phase 4: execute
				let pushOk = 0;

				for (const a of willPush) {
					inlineStart(a.repo, "pushing");
					const pushArgs =
						a.outcome === "will-force-push"
							? ["push", "-u", "--force-with-lease", a.shareRemote, a.branch]
							: ["push", "-u", a.shareRemote, a.branch];
					const pushResult = await Bun.$`git -C ${a.repoDir} ${pushArgs}`.cwd(a.repoDir).quiet().nothrow();
					if (pushResult.exitCode === 0) {
						inlineResult(a.repo, `pushed ${plural(a.ahead, "commit")}`);
						pushOk++;
					} else {
						inlineResult(a.repo, red("failed"));
						process.stderr.write("\n");
						const errText = pushResult.stderr.toString().trim();
						if (errText) {
							for (const line of errText.split("\n")) {
								process.stderr.write(`  ${line}\n`);
							}
						}
						process.stderr.write("\n  To resolve, check the error above, then re-run 'arb push' to continue.\n");
						process.exit(1);
					}
				}

				// Phase 5: summary
				process.stderr.write("\n");
				const parts = [`Pushed ${plural(pushOk, "repo")}`];
				if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
				if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
				success(parts.join(", "));
			},
		);
}

function formatPushPlan(assessments: PushAssessment[], remotesMap: Map<string, RepoRemotes>): string {
	let out = "\n";
	for (const a of assessments) {
		const remotes = remotesMap.get(a.repo);
		const forkSuffix = remotes && remotes.upstream !== remotes.share ? ` → ${a.shareRemote}` : "";
		const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
		if (a.outcome === "will-push") {
			const newBranchSuffix = a.recreate ? " (recreate)" : a.newBranch ? " (new branch)" : "";
			out += `  ${a.repo}   ${plural(a.ahead, "commit")} to push${newBranchSuffix}${forkSuffix}${headStr}\n`;
		} else if (a.outcome === "will-force-push") {
			out += `  ${a.repo}   ${plural(a.ahead, "commit")} to push (force — ${a.behind} behind ${a.shareRemote})${headStr}\n`;
		} else if (a.outcome === "up-to-date") {
			out += `  ${a.repo}   up to date\n`;
		} else {
			out += `  ${yellow(`${a.repo}   skipped — ${a.skipReason}`)}\n`;
		}
	}
	out += "\n";
	return out;
}

async function assessPushRepo(status: RepoStatus, repoDir: string, branch: string): Promise<PushAssessment> {
	const shareRemote = status.share?.remote ?? "origin";

	const headSha = await getShortHead(repoDir);

	const base: PushAssessment = {
		repo: status.name,
		repoDir,
		outcome: "skip",
		ahead: 0,
		behind: 0,
		branch,
		shareRemote,
		newBranch: false,
		headSha,
		recreate: false,
	};

	// Local repo — no share remote
	if (status.share === null) {
		return { ...base, skipReason: "local repo" };
	}

	// Branch check — detached or drifted
	if (status.identity.headMode.kind === "detached") {
		return { ...base, skipReason: "HEAD is detached" };
	}
	if (status.identity.headMode.branch !== branch) {
		return { ...base, skipReason: `on branch ${status.identity.headMode.branch}, expected ${branch}` };
	}

	// Remote branch was deleted (gone) — recreate
	if (status.share.refMode === "gone") {
		const ahead = status.base?.ahead ?? 1;
		return { ...base, outcome: "will-push", ahead, recreate: true };
	}

	// Never pushed (noRef) — new branch
	if (status.share.refMode === "noRef") {
		const ahead = status.base?.ahead ?? 1;
		if (ahead === 0) {
			return { ...base, outcome: "skip", skipReason: "no commits to push" };
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
		return { ...base, outcome: "skip", skipReason: `behind ${shareRemote} (pull first?)`, behind: toPull };
	}

	if (toPush > 0 && toPull > 0) {
		return { ...base, outcome: "will-force-push", ahead: toPush, behind: toPull };
	}

	return { ...base, outcome: "will-push", ahead: toPush };
}
