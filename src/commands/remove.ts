import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import {
	branchExistsLocally,
	getHeadCommitDate,
	git,
	hasRemote,
	remoteBranchExists,
	validateWorkspaceName,
} from "../lib/git";
import { dim, error, green, info, inlineResult, inlineStart, plural, red, success, warn, yellow } from "../lib/output";
import { resolveRemotes } from "../lib/remotes";
import { listWorkspaces, selectInteractive, workspaceRepoDirs } from "../lib/repos";
import { type RepoStatus, computeFlags, gatherRepoStatus, wouldLoseWork } from "../lib/status";
import { type TemplateDiff, diffTemplates } from "../lib/templates";
import { formatRelativeTime, latestCommitDate } from "../lib/time";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

interface WorkspaceAssessment {
	name: string;
	wsDir: string;
	branch: string;
	repos: string[];
	repoStatuses: RepoStatus[];
	remoteRepos: string[];
	atRiskCount: number;
	hasAtRisk: boolean;
	templateDiffs: TemplateDiff[];
	lastCommit: string | null;
}

async function assessWorkspace(name: string, ctx: ArbContext): Promise<WorkspaceAssessment | null> {
	const validationError = validateWorkspaceName(name);
	if (validationError) {
		error(validationError);
		process.exit(1);
	}

	const wsDir = `${ctx.baseDir}/${name}`;
	if (!existsSync(wsDir)) {
		error(`No workspace found for ${name}`);
		process.exit(1);
	}

	// Read branch and base from config
	let branch: string;
	const wb = await workspaceBranch(wsDir);
	if (wb) {
		branch = wb.branch;
	} else {
		branch = name.toLowerCase();
		warn(`Could not determine branch for ${name}, assuming '${branch}'`);
	}
	const configBase = configGet(`${wsDir}/.arbws/config`, "base");

	// Discover repos
	const repoPaths = workspaceRepoDirs(wsDir);
	const repos = repoPaths.map((d) => basename(d));

	if (repos.length === 0) {
		warn(`No worktrees found in ${wsDir} — cleaning up directory`);
		rmSync(wsDir, { recursive: true, force: true });
		return null;
	}

	// Per-repo status gathering
	const repoStatuses: RepoStatus[] = [];
	const commitDates: (string | null)[] = [];
	for (const repo of repos) {
		const wtPath = `${wsDir}/${repo}`;
		const [status, commitDate] = await Promise.all([
			gatherRepoStatus(wtPath, ctx.reposDir, configBase),
			getHeadCommitDate(wtPath),
		]);
		repoStatuses.push(status);
		commitDates.push(commitDate);
	}
	const lastCommit = latestCommitDate(commitDates);

	// Determine at-risk repos and collect remote repos
	let hasAtRisk = false;
	let atRiskCount = 0;
	const remoteRepos: string[] = [];

	for (const status of repoStatuses) {
		if (status.publish !== null) {
			if (status.publish.refMode === "configured" || status.publish.refMode === "implicit") {
				remoteRepos.push(status.name);
			}
		}

		const flags = computeFlags(status, branch);
		const localWithCommits = status.publish === null && status.base !== null && status.base.ahead > 0;
		const atRisk = wouldLoseWork(flags) || localWithCommits;
		if (atRisk) {
			hasAtRisk = true;
			atRiskCount++;
		}
	}

	// Template drift detection
	const templateDiffs = diffTemplates(ctx.baseDir, wsDir, repos);

	return {
		name,
		wsDir,
		branch,
		repos,
		repoStatuses,
		remoteRepos,
		atRiskCount,
		hasAtRisk,
		templateDiffs,
		lastCommit,
	};
}

function displayStatusTable(assessment: WorkspaceAssessment): void {
	const { repos, repoStatuses, atRiskCount, hasAtRisk, templateDiffs, lastCommit } = assessment;

	if (lastCommit) {
		process.stderr.write(`  ${dim(`last commit ${formatRelativeTime(lastCommit)}`)}\n`);
	}

	const maxRepoLen = Math.max(...repos.map((r) => r.length));
	for (const status of repoStatuses) {
		const notPushedWithCommits =
			status.publish !== null && status.publish.refMode === "noRef" && status.base && status.base.ahead > 0;

		const toPush = status.publish !== null ? (status.publish.toPush ?? 0) : 0;

		const parts = [
			status.local.staged > 0 && green(`${status.local.staged} staged`),
			status.local.modified > 0 && yellow(`${status.local.modified} modified`),
			status.local.untracked > 0 && yellow(`${status.local.untracked} untracked`),
			notPushedWithCommits ? red("not pushed at all") : toPush > 0 ? yellow(`${toPush} commits not pushed`) : false,
		]
			.filter(Boolean)
			.join(", ");

		const display = parts || green("\u2714 clean, pushed");
		process.stderr.write(`  ${status.name.padEnd(maxRepoLen)} ${display}\n`);
	}
	process.stderr.write("\n");

	if (hasAtRisk) {
		warn(`  \u26A0 ${plural(atRiskCount, "repo")} ${atRiskCount === 1 ? "has" : "have"} changes that will be lost.`);
		process.stderr.write("\n");
	}

	if (templateDiffs.length > 0) {
		warn("  Template files modified:");
		for (const diff of templateDiffs) {
			const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
			process.stderr.write(`    ${prefix}${diff.relPath}\n`);
		}
		process.stderr.write("\n");
	}
}

async function executeRemoval(
	assessment: WorkspaceAssessment,
	ctx: ArbContext,
	deleteRemote: boolean,
): Promise<string[]> {
	const { wsDir, branch, repos } = assessment;
	const failedRemoteDeletes: string[] = [];

	for (const repo of repos) {
		await git(`${ctx.reposDir}/${repo}`, "worktree", "remove", "--force", `${wsDir}/${repo}`);

		if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
			await git(`${ctx.reposDir}/${repo}`, "branch", "-D", branch);
		}

		if (deleteRemote && (await hasRemote(`${ctx.reposDir}/${repo}`))) {
			let publishRemote = "origin";
			try {
				const remotes = await resolveRemotes(`${ctx.reposDir}/${repo}`);
				publishRemote = remotes.publish;
			} catch {
				// Fall back to origin
			}
			if (await remoteBranchExists(`${ctx.reposDir}/${repo}`, branch, publishRemote)) {
				const pushResult = await git(`${ctx.reposDir}/${repo}`, "push", publishRemote, "--delete", branch);
				if (pushResult.exitCode !== 0) {
					failedRemoteDeletes.push(repo);
				}
			}
		}
	}

	rmSync(wsDir, { recursive: true, force: true });

	for (const repo of repos) {
		await git(`${ctx.reposDir}/${repo}`, "worktree", "prune");
	}

	return failedRemoteDeletes;
}

function isAssessmentOk(assessment: WorkspaceAssessment): boolean {
	for (const status of assessment.repoStatuses) {
		const flags = computeFlags(status, assessment.branch);
		if (wouldLoseWork(flags)) return false;
		if (status.publish === null && status.base !== null && status.base.ahead > 0) return false;
	}
	return true;
}

function buildConfirmMessage(count: number, singleName: string | undefined, deleteRemote: boolean): string {
	const subject = count === 1 && singleName ? `workspace ${singleName}` : plural(count, "workspace");
	const remoteSuffix = deleteRemote ? " and delete remote branches" : "";
	return `Remove ${subject}${remoteSuffix}?`;
}

export function registerRemoveCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("remove [names...]")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-f, --force", "Force removal of at-risk workspaces (implies --yes)")
		.option("-d, --delete-remote", "Delete remote branches")
		.option(
			"-a, --all-ok",
			"Remove all safe workspaces (no uncommitted changes, unpushed commits, or branch drift; behind base is fine)",
		)
		.option("-n, --dry-run", "Show what would happen without executing")
		.summary("Remove one or more workspaces")
		.description(
			"Remove one or more workspaces and their worktrees. Shows the status of each worktree (uncommitted changes, unpushed commits) and any modified template files before proceeding. Prompts with a workspace picker when run without arguments. Use --yes to skip confirmation, --force to override at-risk safety checks, --delete-remote to also delete the remote branches, and --all-ok to batch-remove all workspaces with ok status.",
		)
		.action(
			async (
				nameArgs: string[],
				options: { yes?: boolean; force?: boolean; deleteRemote?: boolean; allOk?: boolean; dryRun?: boolean },
			) => {
				const ctx = getCtx();
				const skipPrompts = options.yes || options.force;
				const forceAtRisk = options.force ?? false;
				const deleteRemote = options.deleteRemote ?? false;

				if (options.allOk) {
					if (nameArgs.length > 0) {
						error("Cannot combine --all-ok with workspace names.");
						process.exit(1);
					}

					const allWorkspaces = listWorkspaces(ctx.baseDir);
					const candidates = allWorkspaces.filter((ws) => ws !== ctx.currentWorkspace);

					if (candidates.length === 0) {
						info("No workspaces to check.");
						return;
					}

					const okEntries: WorkspaceAssessment[] = [];
					for (const ws of candidates) {
						const wsDir = `${ctx.baseDir}/${ws}`;
						if (!existsSync(`${wsDir}/.arbws/config`)) continue;

						const assessment = await assessWorkspace(ws, ctx);
						if (assessment && isAssessmentOk(assessment)) {
							okEntries.push(assessment);
						}
					}

					if (okEntries.length === 0) {
						info("No workspaces with ok status.");
						return;
					}

					process.stderr.write("\n");
					for (const entry of okEntries) {
						process.stderr.write(`${entry.name}:\n`);
						displayStatusTable(entry);
					}

					if (deleteRemote) {
						process.stderr.write("  Remote branches will also be deleted.\n\n");
					}

					if (options.dryRun) return;

					if (!skipPrompts) {
						if (!isTTY()) {
							error("Not a terminal. Use --yes to skip confirmation.");
							process.exit(1);
						}
						const shouldRemove = await confirm(
							{
								message: buildConfirmMessage(okEntries.length, undefined, deleteRemote),
								default: false,
							},
							{ output: process.stderr },
						);
						if (!shouldRemove) {
							process.stderr.write("Aborted.\n");
							process.exit(130);
						}
					}

					for (const entry of okEntries) {
						inlineStart(entry.name, "removing");
						const failedRemoteDeletes = await executeRemoval(entry, ctx, deleteRemote);
						const remoteSuffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
						inlineResult(entry.name, `removed${remoteSuffix}`);
					}

					process.stderr.write("\n");
					success(`Removed ${plural(okEntries.length, "workspace")}`);
					return;
				}

				let names = nameArgs;
				if (names.length === 0) {
					if (!isTTY()) {
						error("No workspace specified.");
						process.exit(1);
					}
					const workspaces = listWorkspaces(ctx.baseDir);
					if (workspaces.length === 0) {
						error("No workspaces found.");
						process.exit(1);
					}
					names = await selectInteractive(workspaces, "Select workspaces to remove");
					if (names.length === 0) {
						error("No workspaces selected.");
						process.exit(1);
					}
				}

				// Assess all workspaces
				const assessments: WorkspaceAssessment[] = [];
				for (const name of names) {
					const assessment = await assessWorkspace(name, ctx);
					if (assessment) assessments.push(assessment);
				}

				if (assessments.length === 0) return;

				// Plan: display status for all workspaces
				const isSingle = assessments.length === 1;
				process.stderr.write("\n");
				for (const assessment of assessments) {
					if (!isSingle) {
						process.stderr.write(`${assessment.name}:\n`);
					}
					displayStatusTable(assessment);
				}

				// Check for at-risk across all workspaces
				const atRiskWorkspaces = assessments.filter((a) => a.hasAtRisk);

				if (atRiskWorkspaces.length > 0 && !forceAtRisk) {
					const atRiskNames = atRiskWorkspaces.map((a) => a.name).join(", ");
					error(
						`Refusing to remove: ${atRiskNames} ${atRiskWorkspaces.length === 1 ? "has" : "have"} work that would be lost. Use --force to override.`,
					);
					process.exit(1);
				}

				if (deleteRemote) {
					process.stderr.write("  Remote branches will also be deleted.\n\n");
				}

				if (options.dryRun) return;

				// Confirm
				if (!skipPrompts) {
					if (!isTTY()) {
						error("Not a terminal. Use --yes to skip confirmation.");
						process.exit(1);
					}

					const shouldRemove = await confirm(
						{
							message: buildConfirmMessage(assessments.length, assessments[0]?.name, deleteRemote),
							default: false,
						},
						{ output: process.stderr },
					);
					if (!shouldRemove) {
						process.stderr.write("Aborted.\n");
						process.exit(130);
					}
				}

				// Execute
				for (const assessment of assessments) {
					if (!isSingle) inlineStart(assessment.name, "removing");
					const failedRemoteDeletes = await executeRemoval(assessment, ctx, deleteRemote);
					if (!isSingle) {
						const suffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
						inlineResult(assessment.name, `removed${suffix}`);
					} else if (failedRemoteDeletes.length > 0) {
						warn("removed (failed to delete remote branch)");
					}
				}

				// Summarize
				if (isSingle) {
					success(`Removed workspace ${assessments[0]?.name}`);
				} else {
					process.stderr.write("\n");
					success(`Removed ${plural(assessments.length, "workspace")}`);
				}
			},
		);
}
