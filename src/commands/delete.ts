import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { loadArbIgnore } from "../lib/arbignore";
import { ArbError } from "../lib/errors";
import { branchExistsLocally, git, remoteBranchExists, validateWorkspaceName } from "../lib/git";
import { confirmOrExit } from "../lib/mutation-flow";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, success, warn, yellow } from "../lib/output";
import { resolveRemotes } from "../lib/remotes";
import { listNonWorkspaces, listWorkspaces, selectInteractive, workspaceRepoDirs } from "../lib/repos";
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
import { readNamesFromStdin } from "../lib/stdin";
import { type Column, renderTable } from "../lib/table";
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

function hintNonWorkspaces(arbRootDir: string): void {
	const ignored = loadArbIgnore(arbRootDir);
	const nonWorkspaces = listNonWorkspaces(arbRootDir, ignored);
	if (nonWorkspaces.length > 0) {
		info(
			`  ${plural(nonWorkspaces.length, "non-workspace directory", "non-workspace directories")} found. Run 'arb clean' to review.`,
		);
	}
}

interface WorkspaceAssessment {
	name: string;
	wsDir: string;
	branch: string;
	repos: string[]; // Repo names from filesystem scan (independent of summary)
	summary: WorkspaceSummary;
	atRiskCount: number;
	hasAtRisk: boolean;
	templateDiffs: TemplateDiff[];
}

async function assessWorkspace(name: string, ctx: ArbContext): Promise<WorkspaceAssessment | null> {
	const validationError = validateWorkspaceName(name);
	if (validationError) {
		error(validationError);
		throw new ArbError(validationError);
	}

	const wsDir = `${ctx.arbRootDir}/${name}`;
	if (!existsSync(wsDir)) {
		error(`No workspace found for ${name}`);
		throw new ArbError(`No workspace found for ${name}`);
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
		warn(`No repos found in ${wsDir} — cleaning up directory`);
		rmSync(wsDir, { recursive: true, force: true });
		return null;
	}

	// Gather workspace summary using the canonical status model.
	// Delete must be resilient to repos with broken/missing/ambiguous remotes —
	// if we can't determine the state, treat the workspace as at-risk.
	let summary: WorkspaceSummary;
	try {
		summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir);
	} catch (e) {
		warn(`Could not gather status for ${name}: ${e instanceof Error ? e.message : e}`);
		summary = {
			workspace: name,
			branch,
			base: null,
			repos: [],
			total: repos.length,
			atRiskCount: repos.length,
			rebasedOnlyCount: 0,
			statusLabels: [],
			statusCounts: [],
			lastCommit: null,
		};
	}

	// Determine at-risk repos
	let hasAtRisk = summary.repos.length === 0 && repos.length > 0;
	let atRiskCount = summary.repos.length === 0 ? repos.length : 0;

	for (const status of summary.repos) {
		const flags = computeFlags(status, branch);
		if (wouldLoseWork(flags)) {
			hasAtRisk = true;
			atRiskCount++;
		}
	}

	// Template drift detection
	const templateDiffs = await diffTemplates(ctx.arbRootDir, wsDir, repos);

	return {
		name,
		wsDir,
		branch,
		repos,
		summary,
		atRiskCount,
		hasAtRisk,
		templateDiffs,
	};
}

function displayDeleteTable(assessments: WorkspaceAssessment[]): void {
	// Last commit column
	const allTimeParts: RelativeTimeParts[] = assessments.map((a) =>
		a.summary.lastCommit ? formatRelativeTimeParts(a.summary.lastCommit) : { num: "", unit: "" },
	);
	const lcWidths: LastCommitWidths = computeLastCommitWidths(allTimeParts);

	// Status text (plain for width, colored for display)
	const statusPlain: string[] = assessments.map((a) => {
		if (a.summary.repos.length === 0 && a.summary.total > 0) return "(remotes not resolved)";
		if (a.summary.statusCounts.length === 0) return "no issues";
		return formatStatusCounts(a.summary.statusCounts, a.summary.rebasedOnlyCount, LOSE_WORK_FLAGS);
	});
	const statusColored: string[] = assessments.map((a, i) => {
		if (a.summary.repos.length === 0 && a.summary.total > 0) return yellow("(remotes not resolved)");
		return statusPlain[i] ?? "";
	});

	const columns: Column<WorkspaceAssessment>[] = [
		{ header: "WORKSPACE", value: (a) => a.name },
		{
			header: "LAST COMMIT",
			value: (_a, i) => {
				const parts = allTimeParts[i];
				if (!parts || (!parts.num && !parts.unit)) return " ".repeat(lcWidths.total);
				return formatLastCommitCell(parts, lcWidths, true);
			},
		},
		{ header: "REPOS", value: (a) => `${a.summary.total}` },
		{
			header: "STATUS",
			value: (_a, i) => statusPlain[i] ?? "",
			render: (_a, i) => statusColored[i] ?? "",
		},
	];

	process.stderr.write(renderTable(columns, assessments));
	process.stderr.write("\n");

	// Template diffs below the table
	const multiWs = assessments.length > 1;
	for (const a of assessments) {
		const suffix = multiWs ? ` (${a.name})` : "";
		displayTemplateDiffs(a.templateDiffs, (text) => process.stderr.write(text), suffix);
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
	const { wsDir, branch, repos } = assessment;
	const failedRemoteDeletes: string[] = [];

	for (const repo of repos) {
		await git(`${ctx.reposDir}/${repo}`, "worktree", "remove", "--force", `${wsDir}/${repo}`);

		if (await branchExistsLocally(`${ctx.reposDir}/${repo}`, branch)) {
			await git(`${ctx.reposDir}/${repo}`, "branch", "-D", branch);
		}

		if (deleteRemote) {
			let shareRemote: string | undefined;
			try {
				const remotes = await resolveRemotes(`${ctx.reposDir}/${repo}`);
				shareRemote = remotes.share;
			} catch {
				// Ambiguous remotes — can't determine which remote to delete from
			}
			if (shareRemote) {
				if (await remoteBranchExists(`${ctx.reposDir}/${repo}`, branch, shareRemote)) {
					const pushResult = await git(`${ctx.reposDir}/${repo}`, "push", shareRemote, "--delete", branch);
					if (pushResult.exitCode !== 0) {
						failedRemoteDeletes.push(repo);
					}
				}
			} else {
				warn(`  [${repo}] could not determine share remote — skipping remote branch deletion`);
			}
		}
	}

	rmSync(wsDir, { recursive: true, force: true });

	for (const repo of repos) {
		await git(`${ctx.reposDir}/${repo}`, "worktree", "prune");
	}

	return failedRemoteDeletes;
}

function buildConfirmMessage(count: number, deleteRemote: boolean): string {
	const remoteSuffix = deleteRemote ? " and delete remote branches" : "";
	return `Delete ${plural(count, "workspace")}${remoteSuffix}?`;
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
		.option("-w, --where <filter>", "Filter workspaces by repo status flags (comma = OR, + = AND, ^ = negate)")
		.option("-n, --dry-run", "Show what would happen without executing")
		.summary("Delete one or more workspaces")
		.description(
			"Delete one or more workspaces and their repos. Shows the status of each repo (uncommitted changes, unpushed commits) and any modified template files before proceeding. Prompts with a workspace picker when run without arguments.\n\nUse --all-safe to batch-delete all workspaces with safe status (no uncommitted changes, unpushed commits, or branch drift). Use --dirty / -d to target only dirty workspaces, or --where <filter> for other status flags. When used without workspace names, --where (or --dirty) selects all matching workspaces (e.g. arb delete --where gone deletes all gone workspaces). When combined with names, --where narrows the selection further (AND logic). Combine with --all-safe to narrow further (e.g. --all-safe --where gone for merged-and-safe workspaces). --where accepts: dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, gone, shallow, merged, base-merged, base-missing, at-risk, stale. Positive/healthy terms: clean, pushed, synced-base, synced-share, synced, safe. Prefix any term with ^ to negate (e.g. --where ^dirty is equivalent to --where clean). Comma-separated values use OR logic; use + for AND (e.g. --where dirty+unpushed). + binds tighter than comma: dirty+unpushed,gone = (dirty AND unpushed) OR gone.\n\nUse --yes to skip confirmation, --force to override at-risk safety checks, --delete-remote to also delete the remote branches.",
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
					throw new ArbError("Cannot combine --dirty with --where. Use --where dirty,... instead.");
				}
				const whereFilter = options.dirty ? "dirty" : options.where;
				if (whereFilter) {
					const err = validateWhere(whereFilter);
					if (err) {
						error(err);
						throw new ArbError(err);
					}
				}

				if (options.allSafe) {
					if (nameArgs.length > 0) {
						error("Cannot combine --all-safe with workspace names.");
						throw new ArbError("Cannot combine --all-safe with workspace names.");
					}

					const allWorkspaces = listWorkspaces(ctx.arbRootDir);
					const candidates = allWorkspaces.filter((ws) => ws !== ctx.currentWorkspace);

					if (candidates.length === 0) {
						info("No workspaces to check.");
						return;
					}

					const safeEntries: WorkspaceAssessment[] = [];
					for (const ws of candidates) {
						const wsDir = `${ctx.arbRootDir}/${ws}`;
						if (!existsSync(`${wsDir}/.arbws/config`)) continue;

						const assessment = await assessWorkspace(ws, ctx);
						if (assessment && !assessment.hasAtRisk && isWorkspaceSafe(assessment.summary.repos, assessment.branch)) {
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

					await confirmOrExit({
						yes: skipPrompts,
						message: buildConfirmMessage(safeEntries.length, deleteRemote),
						skipFlag: options.force ? "--force" : "--yes",
					});

					process.stderr.write("\n");
					for (const entry of safeEntries) {
						inlineStart(entry.name, "deleting");
						const failedRemoteDeletes = await executeDelete(entry, ctx, deleteRemote);
						const remoteSuffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
						inlineResult(entry.name, `deleted${remoteSuffix}`);
					}

					process.stderr.write("\n");
					success(`Deleted ${plural(safeEntries.length, "workspace")}`);
					hintNonWorkspaces(ctx.arbRootDir);
					return;
				}

				let names = nameArgs;
				if (names.length === 0 && whereFilter) {
					// --where replaces positional args: select from all workspaces
					const allWorkspaces = listWorkspaces(ctx.arbRootDir);
					names = allWorkspaces.filter((ws) => ws !== ctx.currentWorkspace);
				} else if (names.length === 0) {
					const stdinNames = await readNamesFromStdin();
					if (stdinNames.length > 0) {
						names = stdinNames;
					} else if (!isTTY() || !process.stdin.isTTY) {
						error("No workspace specified.");
						throw new ArbError("No workspace specified.");
					} else {
						const workspaces = listWorkspaces(ctx.arbRootDir);
						if (workspaces.length === 0) {
							error("No workspaces found.");
							throw new ArbError("No workspaces found.");
						}
						names = await selectInteractive(workspaces, "Select workspaces to delete");
						if (names.length === 0) {
							error("No workspaces selected.");
							throw new ArbError("No workspaces selected.");
						}
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

				if (assessments.length === 0) {
					if (whereFilter) {
						info("No workspaces match the filter.");
					}
					return;
				}

				// Display columnar status table
				displayDeleteTable(assessments);

				// Check for at-risk across all workspaces
				const atRiskWorkspaces = assessments.filter((a) => a.hasAtRisk);

				if (atRiskWorkspaces.length > 0 && !forceAtRisk) {
					const atRiskNames = atRiskWorkspaces.map((a) => a.name).join(", ");
					const msg = `Refusing to delete: ${atRiskNames} ${atRiskWorkspaces.length === 1 ? "has" : "have"} work that would be lost. Use --force to override.`;
					error(msg);
					throw new ArbError(msg);
				}

				if (deleteRemote) {
					process.stderr.write("  Remote branches will also be deleted.\n\n");
				}

				if (options.dryRun) {
					dryRunNotice();
					return;
				}

				// Confirm
				await confirmOrExit({
					yes: skipPrompts,
					message: buildConfirmMessage(assessments.length, deleteRemote),
					skipFlag: options.force ? "--force" : "--yes",
				});

				// Execute
				process.stderr.write("\n");
				for (const assessment of assessments) {
					inlineStart(assessment.name, "deleting");
					const failedRemoteDeletes = await executeDelete(assessment, ctx, deleteRemote);
					const remoteSuffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
					inlineResult(assessment.name, `deleted${remoteSuffix}`);
				}

				// Summarize
				process.stderr.write("\n");
				success(`Deleted ${plural(assessments.length, "workspace")}`);

				hintNonWorkspaces(ctx.arbRootDir);
			},
		);
}
