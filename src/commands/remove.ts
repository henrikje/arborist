import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { branchExistsLocally, git, hasRemote, remoteBranchExists, validateWorkspaceName } from "../lib/git";
import { dim, error, info, inlineResult, inlineStart, plural, success, warn, yellow } from "../lib/output";
import { resolveRemotes } from "../lib/remotes";
import { listWorkspaces, selectInteractive, workspaceRepoDirs } from "../lib/repos";
import {
	type RepoFlags,
	type WorkspaceSummary,
	computeFlags,
	gatherWorkspaceSummary,
	wouldLoseWork,
} from "../lib/status";
import { type TemplateDiff, diffTemplates } from "../lib/templates";
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
		summary,
		remoteRepos,
		atRiskCount,
		hasAtRisk,
		templateDiffs,
	};
}

const YELLOW_FLAGS = new Set<keyof RepoFlags>([
	"isDirty",
	"isUnpushed",
	"isDrifted",
	"isDetached",
	"hasOperation",
	"isLocal",
	"isShallow",
]);

function formatIssueCounts(issueCounts: WorkspaceSummary["issueCounts"]): string {
	return issueCounts
		.map(({ label, key }) => {
			return YELLOW_FLAGS.has(key) ? yellow(label) : label;
		})
		.join(", ");
}

function displayRemoveTable(assessments: WorkspaceAssessment[]): void {
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
		if (a.summary.withIssues === 0) {
			line += "    no issues";
		} else {
			line += `    ${formatIssueCounts(a.summary.issueCounts)}`;
		}

		process.stderr.write(`${line}\n`);
	}

	process.stderr.write("\n");

	// Template diffs below the table
	const multiWs = assessments.length > 1;
	for (const a of assessments) {
		if (a.templateDiffs.length > 0) {
			const suffix = multiWs ? ` (${a.name})` : "";
			warn(`      Template files modified${suffix}:`);
			for (const diff of a.templateDiffs) {
				const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
				process.stderr.write(`          ${prefix}${diff.relPath}\n`);
			}
			process.stderr.write("\n");
		}
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

async function executeRemoval(
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
	for (const status of assessment.summary.repos) {
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
					displayRemoveTable(okEntries);

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

				// Display columnar status table
				process.stderr.write("\n");
				displayRemoveTable(assessments);

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
				const isSingle = assessments.length === 1;
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
