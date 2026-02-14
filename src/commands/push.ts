import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { checkBranchMatch, git, hasRemote, remoteBranchExists } from "../lib/git";
import { error, info, inlineResult, inlineStart, red, success, yellow } from "../lib/output";
import { resolveRepoSelection } from "../lib/repos";
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
}

export function registerPushCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("push [repos...]")
		.option("-f, --force", "Force push with lease (after rebase or amend)")
		.option("-y, --yes", "Skip confirmation prompt")
		.summary("Push the feature branch to origin")
		.description(
			"Push the feature branch to origin for all repos, or only the named repos. Shows a plan and asks for confirmation before pushing. Skips repos without a remote and repos where the branch hasn't been set up for tracking yet. Use --force after rebase or amend to force push with lease.",
		)
		.action(async (repoArgs: string[], options: { force?: boolean; yes?: boolean }) => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);
			const branch = await requireBranch(wsDir, workspace);

			const selectedRepos = resolveRepoSelection(wsDir, repoArgs);

			// Phase 1: assess each repo
			const assessments: PushAssessment[] = [];
			for (const repo of selectedRepos) {
				const repoDir = `${wsDir}/${repo}`;
				assessments.push(await assessPushRepo(repo, repoDir, branch, ctx.reposDir));
			}

			// Reclassify force-push when --force is not set
			for (const a of assessments) {
				if (a.outcome === "will-force-push" && !options.force) {
					a.outcome = "skip";
					a.skipReason = "diverged from origin (use --force)";
				}
			}

			// Phase 2: display plan
			const willPush = assessments.filter((a) => a.outcome === "will-push" || a.outcome === "will-force-push");
			const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
			const skipped = assessments.filter((a) => a.outcome === "skip");

			process.stderr.write("\n");
			for (const a of assessments) {
				if (a.outcome === "will-push") {
					process.stderr.write(`  ${a.repo}   ${a.ahead} commit${a.ahead === 1 ? "" : "s"} to push\n`);
				} else if (a.outcome === "will-force-push") {
					process.stderr.write(
						`  ${a.repo}   ${a.ahead} commit${a.ahead === 1 ? "" : "s"} to push (force — ${a.behind} behind origin)\n`,
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
				const ok = await confirm({
					message: `Push ${willPush.length} repo(s)?`,
					default: false,
				});
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
						? ["push", "--force-with-lease", "origin", a.branch]
						: ["push", "origin", a.branch];
				const pushResult = await Bun.$`git -C ${a.repoDir} ${pushArgs}`.quiet().nothrow();
				if (pushResult.exitCode === 0) {
					inlineResult(a.repo, `pushed ${a.ahead} commit(s)`);
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
			const parts = [`Pushed ${pushOk} repo(s)`];
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
): Promise<PushAssessment> {
	const base: PushAssessment = { repo, repoDir, outcome: "skip", ahead: 0, behind: 0, branch };

	if (!(await hasRemote(`${reposDir}/${repo}`))) {
		return { ...base, skipReason: "local repo" };
	}

	const bm = await checkBranchMatch(repoDir, branch);
	if (!bm.matches) {
		return { ...base, skipReason: `on branch ${bm.actual}, expected ${branch}` };
	}

	// Check upstream
	const upstream = await Bun.$`git -C ${repoDir} config branch.${branch}.remote`.quiet().nothrow();
	if (upstream.exitCode !== 0 || !upstream.text().trim()) {
		return { ...base, skipReason: `no upstream (run: git push -u origin ${branch})` };
	}

	// Check if remote branch exists — if not, this is a first push
	if (!(await remoteBranchExists(repoDir, branch))) {
		// Count commits on the branch for display
		const log = await git(repoDir, "rev-list", "--count", "HEAD");
		const count = log.exitCode === 0 ? Number.parseInt(log.stdout.trim(), 10) : 1;
		return { ...base, outcome: "will-push", ahead: count };
	}

	// Check how many commits ahead/behind origin
	const lr = await git(repoDir, "rev-list", "--left-right", "--count", `origin/${branch}...HEAD`);
	if (lr.exitCode !== 0) {
		return { ...base, skipReason: "cannot compare with origin" };
	}

	const parts = lr.stdout.trim().split(/\s+/);
	const behind = Number.parseInt(parts[0] ?? "0", 10);
	const ahead = Number.parseInt(parts[1] ?? "0", 10);

	if (ahead === 0 && behind === 0) {
		return { ...base, outcome: "up-to-date" };
	}

	if (ahead === 0 && behind > 0) {
		return { ...base, outcome: "skip", skipReason: "behind origin (pull first?)", behind };
	}

	if (ahead > 0 && behind > 0) {
		return { ...base, outcome: "will-force-push", ahead, behind };
	}

	return { ...base, outcome: "will-push", ahead };
}
