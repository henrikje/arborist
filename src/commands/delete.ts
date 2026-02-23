import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { branchExistsLocally, git, hasRemote, remoteBranchExists, validateWorkspaceName } from "../lib/git";
import {
	dim,
	dryRunNotice,
	error,
	info,
	inlineResult,
	inlineStart,
	plural,
	skipConfirmNotice,
	success,
	warn,
} from "../lib/output";
import { resolveRemotes } from "../lib/remotes";
import { listWorkspaces, selectInteractive, workspaceRepoDirs } from "../lib/repos";
import {
	LOSE_WORK_FLAGS,
	type WorkspaceSummary,
	computeFlags,
	formatStatusCounts,
	gatherWorkspaceSummary,
	isWorkspaceSafe,
	validateWhere,
	workspaceMatchesWhere,
	wouldLoseWork,
} from "../lib/status";
import { type TemplateDiff, diffTemplates, displayTemplateDiffs } from "../lib/templates";
import {
	type LastCommitWidths,
	type RelativeTimeParts,
	computeLastCommitWidths,
	formatLastCommitCell,
	formatRelativeTimeParts,
} from "../lib/time";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

interface WorkspaceAssessment {
	name: string;
	wsDir: string;
	branch: string;
	summary: WorkspaceSummary;
	remoteRepos: string[];
	atRiskCount: number;
	hasAtRisk: boolean;
	templateDiffs: TemplateDiff[];
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

	// Read branch from config
	let branch: string;
	const wb = await workspaceBranch(wsDir);
	if (wb) {
		branch = wb.branch;
	} else {
		branch = name.toLowerCase();
		warn(`Could not determine branch for ${name}, assuming '${branch}'`);
	}

	// Discover repos
	const repoPaths = workspaceRepoDirs(wsDir);
	const repos = repoPaths.map((d) => basename(d));

	if (repos.length === 0) {
		warn(`No worktrees found in ${wsDir} — cleaning up directory`);
		rmSync(wsDir, { recursive: true, force: true });
		return null;
	}

	// Gather workspace summary using the canonical status model
	const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir);

	// Determine at-risk repos and collect remote repos
	let hasAtRisk = false;
	let atRiskCount = 0;
	const remoteRepos: string[] = [];

	for (const status of summary.repos) {
		if (status.share !== null) {
			if (status.share.refMode === "configured" || status.share.refMode === "implicit") {
				remoteRepos.push(status.name);
			}
		}

		const flags = computeFlags(status, branch);
		const localWithCommits = status.share === null && status.base !== null && status.base.ahead > 0;
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
		summary,
		remoteRepos,
		atRiskCount,
		hasAtRisk,
		templateDiffs,
	};
}

function displayDeleteTable(assessments: WorkspaceAssessment[]): void {
	// Compute column widths
	let maxName = "WORKSPACE".length;
	let maxRepos = "REPOS".length;

	for (const a of assessments) {
		if (a.name.length > maxName) maxName = a.name.length;
		const reposText = `${a.summary.total}`;
		if (reposText.length > maxRepos) maxRepos = reposText.length;
	}

	// Last commit column
	const allTimeParts: RelativeTimeParts[] = assessments.map((a) =>
		a.summary.lastCommit ? formatRelativeTimeParts(a.summary.lastCommit) : { num: "", unit: "" },
	);
	const lcWidths: LastCommitWidths = computeLastCommitWidths(allTimeParts);

	// Header
	let header = `  ${dim("WORKSPACE")}${" ".repeat(maxName - 9)}`;
	header += `    ${dim("LAST COMMIT")}${" ".repeat(lcWidths.total - 11)}`;
	header += `    ${dim("REPOS")}${" ".repeat(maxRepos - 5)}`;
	header += `    ${dim("STATUS")}`;
	process.stderr.write(`${header}\n`);

	// Rows
	for (let i = 0; i < assessments.length; i++) {
		const a = assessments[i];
		const parts = allTimeParts[i];
		if (!a || !parts) continue;

		let line = `  ${a.name.padEnd(maxName)}`;

		// Last commit cell
		let commitCell: string;
		if (parts.num || parts.unit) {
			commitCell = formatLastCommitCell(parts, lcWidths, true);
		} else {
			commitCell = " ".repeat(lcWidths.total);
		}
		line += `    ${commitCell}`;

		// Repos
		line += `    ${`${a.summary.total}`.padEnd(maxRepos)}`;

		// Status
		if (a.summary.statusCounts.length === 0) {
			line += "    no issues";
		} else {
			line += `    ${formatStatusCounts(a.summary.statusCounts, a.summary.rebasedOnlyCount, LOSE_WORK_FLAGS)}`;
		}

		process.stderr.write(`${line}\n`);
	}

	process.stderr.write("\n");

	// Template diffs below the table
	const multiWs = assessments.length > 1;
	for (const a of assessments) {
		const suffix = multiWs ? ` (${a.name})` : "";
		displayTemplateDiffs(a.templateDiffs, (text) => process.stderr.write(text), warn, suffix);
	}

	// At-risk warnings
	for (const a of assessments) {
		if (a.hasAtRisk) {
			const inWs = multiWs ? ` in ${a.name}` : "";
			warn(
				`  \u26A0 ${plural(a.atRiskCount, "repo")}${inWs} ${a.atRiskCount === 1 ? "has" : "have"} changes that will be lost.`,
			);
		}
	}

	const hasAnyAtRisk = assessments.some((a) => a.hasAtRisk);
	if (hasAnyAtRisk) {
		process.stderr.write("\n");
	}
}

async function executeDelete(
	assessment: WorkspaceAssessment,
	ctx: ArbContext,
	deleteRemote: boolean,
): Promise<string[]> {
	const { wsDir, branch } = assessment;
	const repos = assessment.summary.repos.map((r) => r.name);
	const failedRemoteDeletes: string[] = [];

	for (const repo of repos) {
		await git(`${ctx.reposDir}/${repo}`, "worktree", "remove", "--force", `${wsDir}/${repo}`);

		if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
			await git(`${ctx.reposDir}/${repo}`, "branch", "-D", branch);
		}

		if (deleteRemote && (await hasRemote(`${ctx.reposDir}/${repo}`))) {
			let shareRemote = "origin";
			try {
				const remotes = await resolveRemotes(`${ctx.reposDir}/${repo}`);
				shareRemote = remotes.share;
			} catch {
				// Fall back to origin
			}
			if (await remoteBranchExists(`${ctx.reposDir}/${repo}`, branch, shareRemote)) {
				const pushResult = await git(`${ctx.reposDir}/${repo}`, "push", shareRemote, "--delete", branch);
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

function buildConfirmMessage(count: number, singleName: string | undefined, deleteRemote: boolean): string {
	const subject = count === 1 && singleName ? `workspace ${singleName}` : plural(count, "workspace");
	const remoteSuffix = deleteRemote ? " and delete remote branches" : "";
	return `Delete ${subject}${remoteSuffix}?`;
}

export function registerDeleteCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("delete [names...]")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-f, --force", "Force deletion of at-risk workspaces (implies --yes)")
		.option("-r, --delete-remote", "Delete remote branches")
		.option("-d, --dirty", "Only target dirty workspaces (shorthand for --where dirty)")
		.option(
			"-a, --all-safe",
			"Delete all safe workspaces (no uncommitted changes, unpushed commits, or branch drift; behind base is fine)",
		)
		.option("-w, --where <filter>", "Filter workspaces by repo status flags (comma = OR, + = AND)")
		.option("-n, --dry-run", "Show what would happen without executing")
		.summary("Delete one or more workspaces")
		.description(
			"Delete one or more workspaces and their worktrees. Shows the status of each worktree (uncommitted changes, unpushed commits) and any modified template files before proceeding. Prompts with a workspace picker when run without arguments.\n\nUse --all-safe to batch-delete all workspaces with safe status (no uncommitted changes, unpushed commits, or branch drift). Use --dirty / -d to target only dirty workspaces, or --where <filter> for other status flags. Combine with --all-safe to narrow further (e.g. --all-safe --where gone for merged-and-safe workspaces). --where accepts: dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, local, gone, shallow, at-risk, stale. Comma-separated values use OR logic; use + for AND (e.g. --where dirty+unpushed). + binds tighter than comma: dirty+unpushed,gone = (dirty AND unpushed) OR gone.\n\nUse --yes to skip confirmation, --force to override at-risk safety checks, --delete-remote to also delete the remote branches.",
		)
		.action(
			async (
				nameArgs: string[],
				options: {
					yes?: boolean;
					force?: boolean;
					deleteRemote?: boolean;
					dirty?: boolean;
					allSafe?: boolean;
					where?: string;
					dryRun?: boolean;
				},
			) => {
				const ctx = getCtx();
				const skipPrompts = options.yes || options.force;
				const forceAtRisk = options.force ?? false;
				const deleteRemote = options.deleteRemote ?? false;

				// Resolve --dirty as shorthand for --where dirty
				if (options.dirty && options.where) {
					error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
					process.exit(1);
				}
				const whereFilter = options.dirty ? "dirty" : options.where;
				if (whereFilter) {
					const err = validateWhere(whereFilter);
					if (err) {
						error(err);
						process.exit(1);
					}
				}

				if (options.allSafe) {
					if (nameArgs.length > 0) {
						error("Cannot combine --all-safe with workspace names.");
						process.exit(1);
					}

					const allWorkspaces = listWorkspaces(ctx.baseDir);
					const candidates = allWorkspaces.filter((ws) => ws !== ctx.currentWorkspace);

					if (candidates.length === 0) {
						info("No workspaces to check.");
						return;
					}

					const safeEntries: WorkspaceAssessment[] = [];
					for (const ws of candidates) {
						const wsDir = `${ctx.baseDir}/${ws}`;
						if (!existsSync(`${wsDir}/.arbws/config`)) continue;

						const assessment = await assessWorkspace(ws, ctx);
						if (assessment && isWorkspaceSafe(assessment.summary.repos, assessment.branch)) {
							// Apply --where narrowing (AND with --all-safe)
							if (whereFilter) {
								if (!workspaceMatchesWhere(assessment.summary.repos, assessment.branch, whereFilter)) {
									continue;
								}
							}
							safeEntries.push(assessment);
						}
					}

					if (safeEntries.length === 0) {
						info("No workspaces with safe status.");
						return;
					}

					displayDeleteTable(safeEntries);

					if (deleteRemote) {
						process.stderr.write("  Remote branches will also be deleted.\n\n");
					}

					if (options.dryRun) {
						dryRunNotice();
						return;
					}

					if (!skipPrompts) {
						if (!isTTY()) {
							error("Not a terminal. Use --yes to skip confirmation.");
							process.exit(1);
						}
						const shouldDelete = await confirm(
							{
								message: buildConfirmMessage(safeEntries.length, undefined, deleteRemote),
								default: false,
							},
							{ output: process.stderr },
						);
						if (!shouldDelete) {
							process.stderr.write("Aborted.\n");
							process.exit(130);
						}
					} else {
						skipConfirmNotice(options.force ? "--force" : "--yes");
					}

					for (const entry of safeEntries) {
						inlineStart(entry.name, "deleting");
						const failedRemoteDeletes = await executeDelete(entry, ctx, deleteRemote);
						const remoteSuffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
						inlineResult(entry.name, `deleted${remoteSuffix}`);
					}

					process.stderr.write("\n");
					success(`Deleted ${plural(safeEntries.length, "workspace")}`);
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
					names = await selectInteractive(workspaces, "Select workspaces to delete");
					if (names.length === 0) {
						error("No workspaces selected.");
						process.exit(1);
					}
				}

				// Assess all workspaces
				let assessments: WorkspaceAssessment[] = [];
				for (const name of names) {
					const assessment = await assessWorkspace(name, ctx);
					if (assessment) assessments.push(assessment);
				}

				// Filter by --where
				if (whereFilter) {
					assessments = assessments.filter((a) => workspaceMatchesWhere(a.summary.repos, a.branch, whereFilter));
				}

				if (assessments.length === 0) return;

				// Display columnar status table
				displayDeleteTable(assessments);

				// Check for at-risk across all workspaces
				const atRiskWorkspaces = assessments.filter((a) => a.hasAtRisk);

				if (atRiskWorkspaces.length > 0 && !forceAtRisk) {
					const atRiskNames = atRiskWorkspaces.map((a) => a.name).join(", ");
					error(
						`Refusing to delete: ${atRiskNames} ${atRiskWorkspaces.length === 1 ? "has" : "have"} work that would be lost. Use --force to override.`,
					);
					process.exit(1);
				}

				if (deleteRemote) {
					process.stderr.write("  Remote branches will also be deleted.\n\n");
				}

				if (options.dryRun) {
					dryRunNotice();
					return;
				}

				// Confirm
				if (!skipPrompts) {
					if (!isTTY()) {
						error("Not a terminal. Use --yes to skip confirmation.");
						process.exit(1);
					}

					const shouldDelete = await confirm(
						{
							message: buildConfirmMessage(assessments.length, assessments[0]?.name, deleteRemote),
							default: false,
						},
						{ output: process.stderr },
					);
					if (!shouldDelete) {
						process.stderr.write("Aborted.\n");
						process.exit(130);
					}
				} else {
					skipConfirmNotice(options.force ? "--force" : "--yes");
				}

				// Execute
				const isSingle = assessments.length === 1;
				for (const assessment of assessments) {
					if (!isSingle) inlineStart(assessment.name, "deleting");
					const failedRemoteDeletes = await executeDelete(assessment, ctx, deleteRemote);
					if (!isSingle) {
						const suffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
						inlineResult(assessment.name, `deleted${suffix}`);
					} else if (failedRemoteDeletes.length > 0) {
						warn("deleted (failed to delete remote branch)");
					}
				}

				// Summarize
				if (isSingle) {
					success(`Deleted workspace ${assessments[0]?.name}`);
				} else {
					process.stderr.write("\n");
					success(`Deleted ${plural(assessments.length, "workspace")}`);
				}
			},
		);
}
