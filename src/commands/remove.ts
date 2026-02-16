import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import {
	branchExistsLocally,
	git,
	hasRemote,
	isRepoDirty,
	remoteBranchExists,
	validateWorkspaceName,
} from "../lib/git";
import { error, green, info, inlineResult, inlineStart, plural, red, success, warn, yellow } from "../lib/output";
import { resolveRemotes } from "../lib/remotes";
import { listWorkspaces, selectInteractive, workspaceRepoDirs } from "../lib/repos";
import { type RepoStatus, gatherRepoStatus, isDirty, isUnpushed } from "../lib/status";
import { type TemplateDiff, diffTemplates } from "../lib/templates";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

interface WorkspaceAssessment {
	name: string;
	wsDir: string;
	branch: string;
	repos: string[];
	repoStatuses: RepoStatus[];
	canonicalDirtyMap: Map<string, boolean>;
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
	for (const repo of repos) {
		const wtPath = `${wsDir}/${repo}`;
		repoStatuses.push(await gatherRepoStatus(wtPath, ctx.reposDir, branch, configBase));
	}

	// Check canonical repos for dirt
	const canonicalDirtyMap = new Map<string, boolean>();
	for (const repo of repos) {
		const repoPath = `${ctx.reposDir}/${repo}`;
		canonicalDirtyMap.set(repo, await isRepoDirty(repoPath));
	}

	// Determine at-risk repos and collect remote repos
	let hasAtRisk = false;
	let atRiskCount = 0;
	const remoteRepos: string[] = [];

	for (const status of repoStatuses) {
		const repoPath = `${ctx.reposDir}/${status.name}`;
		if (await hasRemote(repoPath)) {
			if (status.remote.pushed) {
				remoteRepos.push(status.name);
			}
		}

		const repoIsDirty = isDirty(status);
		const repoIsUnpushed = !status.remote.local && isUnpushed(status);
		const canonicalDirty = canonicalDirtyMap.get(status.name) ?? false;

		let notPushedWithCommits = false;
		if (!status.remote.local && !status.remote.pushed && status.base && status.base.ahead > 0) {
			notPushedWithCommits = true;
		}

		const atRisk = repoIsDirty || repoIsUnpushed || notPushedWithCommits || canonicalDirty;
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
		canonicalDirtyMap,
		remoteRepos,
		atRiskCount,
		hasAtRisk,
		templateDiffs,
	};
}

function displayStatusTable(assessment: WorkspaceAssessment): void {
	const { repos, repoStatuses, canonicalDirtyMap, atRiskCount, hasAtRisk, templateDiffs } = assessment;

	const maxRepoLen = Math.max(...repos.map((r) => r.length));
	for (const status of repoStatuses) {
		const canonicalDirty = canonicalDirtyMap.get(status.name) ?? false;
		const notPushedWithCommits = !status.remote.local && !status.remote.pushed && status.base && status.base.ahead > 0;

		const parts = [
			status.local.staged > 0 && green(`${status.local.staged} staged`),
			status.local.modified > 0 && yellow(`${status.local.modified} modified`),
			status.local.untracked > 0 && yellow(`${status.local.untracked} untracked`),
			canonicalDirty && yellow("canonical repo dirty"),
			notPushedWithCommits
				? red("not pushed at all")
				: status.remote.pushed && status.remote.ahead > 0
					? yellow(`${status.remote.ahead} commits not pushed`)
					: !status.remote.local && !status.remote.pushed && false,
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
	for (const repo of assessment.repoStatuses) {
		if (isDirty(repo)) return false;
		if (!repo.remote.local && isUnpushed(repo)) return false;
		if (repo.branch.drifted) return false;
		if (repo.remote.local && repo.base && repo.base.ahead > 0) return false;
	}
	return true;
}

export function registerRemoveCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("remove [names...]")
		.option("-f, --force", "Force removal without prompts")
		.option("-d, --delete-remote", "Delete remote branches")
		.option(
			"-a, --all-ok",
			"Remove all safe workspaces (no uncommitted changes, unpushed commits, or branch drift; behind base is fine)",
		)
		.option("-n, --dry-run", "Show what would happen without executing")
		.summary("Remove one or more workspaces")
		.description(
			"Remove one or more workspaces and their worktrees. Shows the status of each worktree (uncommitted changes, unpushed commits) and any modified template files before proceeding. Prompts with a workspace picker when run without arguments. Use --force to skip prompts, --delete-remote to also delete the remote branches, and --all-ok to batch-remove all workspaces with ok status.",
		)
		.action(
			async (
				nameArgs: string[],
				options: { force?: boolean; deleteRemote?: boolean; allOk?: boolean; dryRun?: boolean },
			) => {
				const ctx = getCtx();

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

					const okEntries: { assessment: WorkspaceAssessment; behind: number }[] = [];
					for (const ws of candidates) {
						const wsDir = `${ctx.baseDir}/${ws}`;
						if (!existsSync(`${wsDir}/.arbws/config`)) continue;

						const assessment = await assessWorkspace(ws, ctx);
						if (assessment && isAssessmentOk(assessment)) {
							let behind = 0;
							for (const repo of assessment.repoStatuses) {
								if (repo.base && repo.base.behind > 0) behind++;
								if (repo.remote.behind > 0) behind++;
							}
							okEntries.push({ assessment, behind });
						}
					}

					if (okEntries.length === 0) {
						info("No workspaces with ok status.");
						return;
					}

					process.stderr.write("\nWorkspaces to remove:\n");
					for (const entry of okEntries) {
						const annotations: string[] = [];
						if (entry.behind > 0) annotations.push(yellow(`${entry.behind} behind`));
						if (entry.assessment.templateDiffs.length > 0)
							annotations.push(yellow(`${plural(entry.assessment.templateDiffs.length, "template file")} modified`));
						const suffix = annotations.length > 0 ? ` (${annotations.join(", ")})` : "";
						process.stderr.write(`  ${entry.assessment.name}${suffix}\n`);
					}
					process.stderr.write("\n");

					if (options.dryRun) return;

					if (!options.force) {
						if (!process.stdin.isTTY) {
							error("Cannot prompt for confirmation: not a terminal. Use --force to skip prompts.");
							process.exit(1);
						}
						const shouldRemove = await confirm(
							{
								message: `Remove ${plural(okEntries.length, "workspace")}?`,
								default: false,
							},
							{ output: process.stderr },
						);
						if (!shouldRemove) {
							process.stderr.write("Aborted.\n");
							return;
						}
					}

					for (const entry of okEntries) {
						inlineStart(entry.assessment.name, "removing");
						const failedRemoteDeletes = await executeRemoval(entry.assessment, ctx, options.deleteRemote ?? false);
						const remoteSuffix = failedRemoteDeletes.length > 0 ? " (failed to delete remote branch)" : "";
						inlineResult(entry.assessment.name, `removed${remoteSuffix}`);
					}

					process.stderr.write("\n");
					success(`Removed ${plural(okEntries.length, "workspace")}`);
					return;
				}

				let names = nameArgs;
				if (names.length === 0) {
					if (!process.stdin.isTTY) {
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

				if (options.dryRun) return;

				// Check for at-risk across all workspaces
				const atRiskWorkspaces = assessments.filter((a) => a.hasAtRisk);
				let deleteRemote = options.deleteRemote ?? false;

				// Confirm
				if (!options.force) {
					if (atRiskWorkspaces.length > 0) {
						const atRiskNames = atRiskWorkspaces.map((a) => a.name).join(", ");
						error(
							`Refusing to remove: ${atRiskNames} ${atRiskWorkspaces.length === 1 ? "has" : "have"} work that would be lost. Use --force to override.`,
						);
						process.exit(1);
					}

					if (!process.stdin.isTTY) {
						error("Cannot prompt for confirmation: not a terminal. Use --force to skip prompts.");
						process.exit(1);
					}

					const singleName = assessments[0]?.name;
					const confirmMsg = isSingle
						? `Remove workspace ${singleName}?`
						: `Remove ${plural(assessments.length, "workspace")}?`;
					const shouldRemove = await confirm({ message: confirmMsg, default: false }, { output: process.stderr });
					if (!shouldRemove) {
						process.stderr.write("Aborted.\n");
						return;
					}

					const allRemoteRepos = assessments.flatMap((a) => a.remoteRepos);
					if (allRemoteRepos.length > 0 && !deleteRemote) {
						deleteRemote = await confirm(
							{ message: "Also delete remote branches?", default: false },
							{ output: process.stderr },
						);
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
