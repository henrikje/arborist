import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { checkBranchMatch, getDefaultBranch, git, hasRemote, remoteBranchExists } from "../lib/git";
import { dim, error, info, inlineResult, inlineStart, plural, red, success, yellow } from "../lib/output";
import { parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { type RepoRemotes, resolveRemotesMap } from "../lib/remotes";
import { classifyRepos, resolveRepoSelection } from "../lib/repos";
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
	publishRemote: string;
	newBranch: boolean;
	headSha: string;
	recreate: boolean;
}

export function registerPushCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("push [repos...]")
		.option("-f, --force", "Force push with lease (after rebase or amend)")
		.option("--no-fetch", "Skip fetching before push")
		.option("-y, --yes", "Skip confirmation prompt")
		.summary("Push the feature branch to the publish remote")
		.description(
			"Fetches all repos, then pushes the feature branch for all repos, or only the named repos. Pushes to the publish remote (origin by default, or as configured for fork workflows). Sets up tracking on first push. Shows a plan and asks for confirmation before pushing. If a remote branch was deleted (e.g. after merging a PR), the push recreates it. Skips repos without a remote and repos where the remote branch has been deleted. Use --force after rebase or amend to force push with lease. Use --no-fetch to skip fetching when refs are known to be fresh.",
		)
		.action(async (repoArgs: string[], options: { force?: boolean; fetch?: boolean; yes?: boolean }) => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);
			const branch = await requireBranch(wsDir, workspace);

			const selectedRepos = resolveRepoSelection(wsDir, repoArgs);
			const remotesMap = await resolveRemotesMap(selectedRepos, ctx.reposDir);
			const configBase = configGet(`${wsDir}/.arbws/config`, "base");

			// Phase 0: fetch (unless --no-fetch)
			if (options.fetch !== false) {
				const { repos: allRepos, fetchDirs, localRepos } = await classifyRepos(wsDir, ctx.reposDir);
				if (fetchDirs.length > 0) {
					process.stderr.write(`Fetching ${plural(fetchDirs.length, "repo")}...\n`);
					const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
					reportFetchFailures(allRepos, localRepos, fetchResults);
				}
			}

			// Phase 1: assess each repo
			const assessments: PushAssessment[] = [];
			for (const repo of selectedRepos) {
				const repoDir = `${wsDir}/${repo}`;
				assessments.push(await assessPushRepo(repo, repoDir, branch, ctx.reposDir, configBase, remotesMap.get(repo)));
			}

			// Reclassify force-push when --force is not set
			for (const a of assessments) {
				if (a.outcome === "will-force-push" && !options.force) {
					a.outcome = "skip";
					a.skipReason = `diverged from ${a.publishRemote} (use --force)`;
				}
			}

			// Phase 2: display plan
			const willPush = assessments.filter((a) => a.outcome === "will-push" || a.outcome === "will-force-push");
			const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
			const skipped = assessments.filter((a) => a.outcome === "skip");

			process.stderr.write("\n");
			for (const a of assessments) {
				const remotes = remotesMap.get(a.repo);
				const forkSuffix = remotes && remotes.upstream !== remotes.publish ? ` → ${a.publishRemote}` : "";
				const headStr = a.headSha ? `  ${dim(`(HEAD ${a.headSha})`)}` : "";
				if (a.outcome === "will-push") {
					const newBranchSuffix = a.recreate ? " (recreate)" : a.newBranch ? " (new branch)" : "";
					process.stderr.write(
						`  ${a.repo}   ${plural(a.ahead, "commit")} to push${newBranchSuffix}${forkSuffix}${headStr}\n`,
					);
				} else if (a.outcome === "will-force-push") {
					process.stderr.write(
						`  ${a.repo}   ${plural(a.ahead, "commit")} to push (force — ${a.behind} behind ${a.publishRemote})${headStr}\n`,
					);
				} else if (a.outcome === "up-to-date") {
					process.stderr.write(`  ${a.repo}   up to date\n`);
				} else {
					process.stderr.write(`  ${yellow(`${a.repo}   skipped — ${a.skipReason}`)}\n`);
				}
			}
			process.stderr.write("\n");

			if (willPush.length === 0) {
				info(upToDate.length > 0 ? "All repos up to date" : "Nothing to do");
				return;
			}

			// Phase 3: confirm
			if (!options.yes) {
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
						? ["push", "-u", "--force-with-lease", a.publishRemote, a.branch]
						: ["push", "-u", a.publishRemote, a.branch];
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
		});
}

async function assessPushRepo(
	repo: string,
	repoDir: string,
	branch: string,
	reposDir: string,
	configBase: string | null,
	remotes?: RepoRemotes,
): Promise<PushAssessment> {
	const publishRemote = remotes?.publish ?? "origin";
	const upstreamRemote = remotes?.upstream ?? "origin";

	// Capture HEAD SHA for recovery info
	const headResult = await git(repoDir, "rev-parse", "--short", "HEAD");
	const headSha = headResult.exitCode === 0 ? headResult.stdout.trim() : "";

	const base: PushAssessment = {
		repo,
		repoDir,
		outcome: "skip",
		ahead: 0,
		behind: 0,
		branch,
		publishRemote,
		newBranch: false,
		headSha,
		recreate: false,
	};

	if (!(await hasRemote(`${reposDir}/${repo}`))) {
		return { ...base, skipReason: "local repo" };
	}

	const bm = await checkBranchMatch(repoDir, branch);
	if (!bm.matches) {
		return { ...base, skipReason: `on branch ${bm.actual}, expected ${branch}` };
	}

	// Check if remote branch exists
	if (!(await remoteBranchExists(repoDir, branch, publishRemote))) {
		// Tracking config present means the branch was pushed before (set by git push -u).
		// If it's gone now, the remote branch was deleted (e.g. merged via PR).
		const trackingRemote = await Bun.$`git -C ${repoDir} config branch.${branch}.remote`.cwd(repoDir).quiet().nothrow();
		const isGone = trackingRemote.exitCode === 0 && trackingRemote.text().trim().length > 0;

		// Count commits ahead of base branch.
		const repoPath = `${reposDir}/${repo}`;
		let defaultBranch: string | null = null;
		if (configBase) {
			const baseExists = await remoteBranchExists(repoPath, configBase, upstreamRemote);
			if (baseExists) defaultBranch = configBase;
		}
		if (!defaultBranch) {
			defaultBranch = await getDefaultBranch(repoPath, upstreamRemote);
		}
		let count = 1;
		if (defaultBranch) {
			const log = await git(repoDir, "rev-list", "--count", `${upstreamRemote}/${defaultBranch}..HEAD`);
			if (log.exitCode === 0) {
				count = Number.parseInt(log.stdout.trim(), 10);
			} else {
				// Fall back to total count if base comparison fails
				const fallback = await git(repoDir, "rev-list", "--count", "HEAD");
				if (fallback.exitCode === 0) count = Number.parseInt(fallback.stdout.trim(), 10);
			}
		} else {
			const log = await git(repoDir, "rev-list", "--count", "HEAD");
			if (log.exitCode === 0) count = Number.parseInt(log.stdout.trim(), 10);
		}
		return { ...base, outcome: "will-push", ahead: count, newBranch: !isGone, recreate: isGone };
	}

	// Check how many commits ahead/behind the publish remote
	const lr = await git(repoDir, "rev-list", "--left-right", "--count", `${publishRemote}/${branch}...HEAD`);
	if (lr.exitCode !== 0) {
		return { ...base, skipReason: `cannot compare with ${publishRemote}` };
	}

	const parts = lr.stdout.trim().split(/\s+/);
	const behind = Number.parseInt(parts[0] ?? "0", 10);
	const ahead = Number.parseInt(parts[1] ?? "0", 10);

	if (ahead === 0 && behind === 0) {
		return { ...base, outcome: "up-to-date" };
	}

	if (ahead === 0 && behind > 0) {
		return { ...base, outcome: "skip", skipReason: `behind ${publishRemote} (pull first?)`, behind };
	}

	if (ahead > 0 && behind > 0) {
		return { ...base, outcome: "will-force-push", ahead, behind };
	}

	return { ...base, outcome: "will-push", ahead };
}
