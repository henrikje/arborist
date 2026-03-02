import { existsSync, renameSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { configGet, writeConfig } from "../lib/config";
import { ArbError } from "../lib/errors";
import {
	branchExistsLocally,
	detectOperation,
	git,
	remoteBranchExists,
	validateBranchName,
	validateWorkspaceName,
} from "../lib/git";
import { GitCache } from "../lib/git-cache";
import { confirmOrExit, runPlanFlow } from "../lib/mutation-flow";
import {
	dim,
	dryRunNotice,
	error,
	finishSummary,
	info,
	inlineResult,
	inlineStart,
	plural,
	red,
	success,
	warn,
	yellow,
} from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import { type Column, renderTable } from "../lib/table";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

type RenameOutcome = "will-rename" | "already-on-new" | "skip-missing" | "skip-drifted" | "skip-in-progress";

interface RepoAssessment {
	repo: string;
	repoDir: string;
	outcome: RenameOutcome;
	currentBranch: string | null;
	operationType: string | null;
	oldRemoteExists: boolean;
	newRemoteExists: boolean;
	shareRemote: string | null;
}

type AbortOutcome = "roll-back" | "already-reverted" | "skip-unknown";

interface AbortAssessment {
	repo: string;
	repoDir: string;
	outcome: AbortOutcome;
	currentBranch: string | null;
}

interface RenameOptions {
	continue?: boolean;
	abort?: boolean;
	deleteRemote?: boolean;
	fetch?: boolean;
	dryRun?: boolean;
	yes?: boolean;
	includeInProgress?: boolean;
	workspaceName?: string;
	keepWorkspaceName?: boolean;
}

async function assessRepo(
	repoDir: string,
	oldBranch: string,
	newBranch: string,
	shareRemote: string | null,
	options: { includeInProgress: boolean },
): Promise<RepoAssessment> {
	const repo = basename(repoDir);

	// Check in-progress git operation first
	const op = await detectOperation(repoDir);
	if (op !== null && !options.includeInProgress) {
		return {
			repo,
			repoDir,
			outcome: "skip-in-progress",
			currentBranch: null,
			operationType: op,
			oldRemoteExists: false,
			newRemoteExists: false,
			shareRemote,
		};
	}

	// Get current HEAD branch
	const headResult = await git(repoDir, "branch", "--show-current");
	const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() || null : null;

	// Check if already on new branch
	if (currentBranch === newBranch) {
		const [oldRemoteExists, newRemoteExists] = shareRemote
			? await Promise.all([
					remoteBranchExists(repoDir, oldBranch, shareRemote),
					remoteBranchExists(repoDir, newBranch, shareRemote),
				])
			: [false, false];
		return {
			repo,
			repoDir,
			outcome: "already-on-new",
			currentBranch,
			operationType: op,
			oldRemoteExists,
			newRemoteExists,
			shareRemote,
		};
	}

	// Check if old branch exists locally (covers both "on old branch" and "old branch exists but HEAD elsewhere")
	const oldExists = await branchExistsLocally(repoDir, oldBranch);
	const [oldRemoteExists, newRemoteExists] = shareRemote
		? await Promise.all([
				remoteBranchExists(repoDir, oldBranch, shareRemote),
				remoteBranchExists(repoDir, newBranch, shareRemote),
			])
		: [false, false];

	if (oldExists) {
		return {
			repo,
			repoDir,
			outcome: "will-rename",
			currentBranch,
			operationType: op,
			oldRemoteExists,
			newRemoteExists,
			shareRemote,
		};
	}

	// Old branch doesn't exist — HEAD is not on new branch either
	// If HEAD is on some other unexpected branch, it's drifted
	if (currentBranch && currentBranch !== oldBranch) {
		return {
			repo,
			repoDir,
			outcome: "skip-drifted",
			currentBranch,
			operationType: op,
			oldRemoteExists,
			newRemoteExists,
			shareRemote,
		};
	}

	return {
		repo,
		repoDir,
		outcome: "skip-missing",
		currentBranch,
		operationType: op,
		oldRemoteExists,
		newRemoteExists,
		shareRemote,
	};
}

function formatPlan(
	assessments: RepoAssessment[],
	oldBranch: string,
	newBranch: string,
	deleteRemote: boolean,
	newWorkspaceName: string | null,
	fetchingNotice?: string,
): string {
	const hasAnyRemote = assessments.some((a) => a.shareRemote !== null);

	// Compute plain and colored display per assessment
	const displays = assessments.map((a) => {
		let plainAction: string;
		let coloredAction: string;
		let remoteNote = "";

		switch (a.outcome) {
			case "will-rename":
				plainAction = `rename ${oldBranch} to ${newBranch}`;
				coloredAction = plainAction;
				if (a.shareRemote) {
					if (a.newRemoteExists) {
						remoteNote = yellow(`${a.shareRemote}/${newBranch} already exists (may conflict)`);
					} else if (a.oldRemoteExists && deleteRemote) {
						remoteNote = `delete ${a.shareRemote}/${oldBranch}`;
					} else if (a.oldRemoteExists) {
						remoteNote = `leave ${a.shareRemote}/${oldBranch} in place ${dim("(add --delete-remote to delete)")}`;
					}
				}
				break;
			case "already-on-new":
				plainAction = "already renamed";
				coloredAction = yellow(plainAction);
				break;
			case "skip-missing":
				plainAction = "skip — branch not found";
				coloredAction = yellow(plainAction);
				break;
			case "skip-drifted":
				plainAction = `skip — on branch ${a.currentBranch ?? "?"}, expected ${oldBranch}`;
				coloredAction = yellow(plainAction);
				break;
			case "skip-in-progress":
				plainAction = `skip — ${a.operationType} in progress (use --include-in-progress)`;
				coloredAction = yellow(plainAction);
				break;
			default:
				plainAction = "unknown";
				coloredAction = plainAction;
		}

		return { plainAction, coloredAction, remoteNote };
	});

	let out = `\n  Renaming branch '${oldBranch}' to '${newBranch}'\n`;

	if (newWorkspaceName) {
		out += `  Renaming workspace to '${newWorkspaceName}' ${dim("(add --keep-workspace-name to skip)")}\n`;
	}

	out += "\n";

	const columns: Column<RepoAssessment>[] = [
		{ header: "REPO", value: (a) => a.repo },
		{
			header: "LOCAL",
			value: (_a, i) => displays[i]?.plainAction ?? "",
			render: (_a, i) => displays[i]?.coloredAction ?? "",
		},
	];
	if (hasAnyRemote) {
		columns.push({
			header: "REMOTE",
			value: (_a, i) => displays[i]?.remoteNote || "no remote branch",
			render: (_a, i) => displays[i]?.remoteNote || "no remote branch",
		});
	}

	out += renderTable(columns, assessments, { gap: 3 });

	if (fetchingNotice) {
		out += fetchingNotice;
	}

	out += "\n";
	return out;
}

function formatAbortPlan(assessments: AbortAssessment[], oldBranch: string, newBranch: string): string {
	const plainActions = assessments.map((a) => {
		switch (a.outcome) {
			case "roll-back":
				return `rename ${newBranch} to ${oldBranch}`;
			case "already-reverted":
				return `already on ${oldBranch}`;
			case "skip-unknown":
				return `skip — on branch ${a.currentBranch ?? "?"}, expected ${newBranch}`;
			default:
				return "unknown";
		}
	});
	const coloredActions = assessments.map((a, i) => {
		switch (a.outcome) {
			case "roll-back":
				return plainActions[i] ?? "";
			case "already-reverted":
				return dim(plainActions[i] ?? "");
			case "skip-unknown":
				return yellow(plainActions[i] ?? "");
			default:
				return plainActions[i] ?? "";
		}
	});

	let out = `\n  Rolling back rename: '${newBranch}' to '${oldBranch}'\n\n`;
	out += renderTable<AbortAssessment>(
		[
			{ header: "REPO", value: (a) => a.repo },
			{
				header: "LOCAL",
				value: (_a, i) => plainActions[i] ?? "",
				render: (_a, i) => coloredActions[i] ?? "",
			},
		],
		assessments,
		{ gap: 3 },
	);

	out += "\n";
	return out;
}

function renameWorkspace(
	ctx: ArbContext,
	wsDir: string,
	workspace: string,
	newWorkspaceName: string,
	repos: string[],
): boolean {
	const newWsDir = `${ctx.arbRootDir}/${newWorkspaceName}`;
	try {
		renameSync(wsDir, newWsDir);
	} catch (err) {
		warn(`Failed to rename workspace directory: ${err instanceof Error ? err.message : err}`);
		info(`  Manually rename: mv '${workspace}' '${newWorkspaceName}'`);
		info("  Then repair worktrees: arb exec -- git worktree repair");
		return false;
	}

	// Fix worktree path references in canonical repos
	let repairFailed = false;
	for (const repo of repos) {
		const result = Bun.spawnSync(["git", "worktree", "repair", `${newWsDir}/${repo}`], {
			cwd: `${ctx.reposDir}/${repo}`,
			stdout: "ignore",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) {
			repairFailed = true;
		}
	}

	if (repairFailed) {
		warn("Some worktree repairs failed — run 'arb exec -- git worktree repair' in the new workspace");
	}

	inlineResult(workspace, `workspace renamed to ${newWorkspaceName}`);
	return true;
}

async function runRename(
	wsDir: string,
	ctx: ArbContext,
	workspace: string,
	configFile: string,
	oldBranch: string,
	newBranch: string,
	configBase: string | null,
	newWorkspaceName: string | null,
	options: RenameOptions,
): Promise<void> {
	const repoDirs = workspaceRepoDirs(wsDir);
	const repos = repoDirs.map((d) => basename(d));

	if (repoDirs.length === 0) {
		info("No repos in this workspace");
		return;
	}

	// Resolve remotes for all repos (canonical repos share remote config with worktrees)
	const cache = new GitCache();
	const fullRemotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);

	const fetchDirs = workspaceRepoDirs(wsDir);

	const shouldFetch = options.fetch !== false;

	const assess = async (_fetchFailed: string[]): Promise<RepoAssessment[]> => {
		return Promise.all(
			repoDirs.map((repoDir) => {
				const repo = basename(repoDir);
				const shareRemote = fullRemotesMap.get(repo)?.share ?? null;
				return assessRepo(repoDir, oldBranch, newBranch, shareRemote, {
					includeInProgress: options.includeInProgress ?? false,
				});
			}),
		);
	};

	const assessments = await runPlanFlow({
		shouldFetch,
		fetchDirs,
		reposForFetchReport: repos,
		remotesMap: fullRemotesMap,
		assess,
		formatPlan: (nextAssessments) =>
			formatPlan(nextAssessments, oldBranch, newBranch, options.deleteRemote ?? false, newWorkspaceName),
		onPostFetch: () => cache.invalidateAfterFetch(),
	});

	const willRename = assessments.filter((a) => a.outcome === "will-rename");

	if (willRename.length === 0) {
		info("Nothing to rename");
		return;
	}

	if (options.dryRun) {
		dryRunNotice();
		return;
	}

	// Confirm
	await confirmOrExit({
		yes: options.yes,
		message: `Rename branch in ${plural(willRename.length, "repo")}?`,
	});

	process.stderr.write("\n");

	// Pre-update config: write new branch + migration state BEFORE git ops
	// This means arb status immediately reflects intent; branch_rename_from preserves recovery info
	writeConfig(configFile, newBranch, configBase, oldBranch);

	// Execute local renames sequentially
	let renameOk = 0;
	const failures: string[] = [];

	for (const a of willRename) {
		inlineStart(a.repo, "renaming");
		const result = await git(a.repoDir, "branch", "-m", oldBranch, newBranch);
		if (result.exitCode === 0) {
			// Clear stale tracking left by git branch -m.
			// Without this, @{upstream} resolves to origin/<oldBranch> and
			// arb push reports "up to date" instead of pushing the new name.
			await git(a.repoDir, "config", "--unset", `branch.${newBranch}.remote`);
			await git(a.repoDir, "config", "--unset", `branch.${newBranch}.merge`);
			inlineResult(a.repo, `local branch renamed to ${newBranch}`);
			renameOk++;
		} else {
			inlineResult(a.repo, red("failed"));
			failures.push(a.repo);
		}
	}

	if (failures.length > 0) {
		process.stderr.write("\n");
		error(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
		warn("Use 'arb branch rename --continue' to retry or 'arb branch rename --abort' to roll back");
		throw new ArbError(`Failed to rename in ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
	}

	// Clear stale tracking for repos already on the new branch (e.g. --continue after partial)
	for (const a of assessments.filter((a) => a.outcome === "already-on-new")) {
		const mergeRef = await git(a.repoDir, "config", `branch.${newBranch}.merge`);
		if (mergeRef.exitCode === 0 && mergeRef.stdout.trim() === `refs/heads/${oldBranch}`) {
			await git(a.repoDir, "config", "--unset", `branch.${newBranch}.remote`);
			await git(a.repoDir, "config", "--unset", `branch.${newBranch}.merge`);
		}
	}

	// All local renames succeeded — clear migration state
	writeConfig(configFile, newBranch, configBase, null);

	// Remote cleanup — only runs after all local renames succeed so --abort never needs to touch remotes
	if (options.deleteRemote) {
		const withOldRemote = willRename.filter((a) => a.oldRemoteExists && a.shareRemote !== null);
		if (withOldRemote.length > 0) {
			for (const a of withOldRemote) {
				inlineStart(a.repo, `deleting ${a.shareRemote}/${oldBranch}`);
				// Use canonical repo dir for remote operations
				const canonicalDir = `${ctx.reposDir}/${a.repo}`;
				// biome-ignore lint/style/noNonNullAssertion: filtered above
				const result = await git(canonicalDir, "push", a.shareRemote!, "--delete", oldBranch);
				if (result.exitCode === 0) {
					inlineResult(a.repo, `deleted remote branch ${a.shareRemote}/${oldBranch}`);
				} else {
					inlineResult(a.repo, yellow(`failed to delete remote branch ${a.shareRemote}/${oldBranch}`));
				}
			}
		}
	}

	// Workspace rename — after all per-repo operations complete
	let renamedWorkspace = false;
	if (newWorkspaceName) {
		renamedWorkspace = renameWorkspace(ctx, wsDir, workspace, newWorkspaceName, repos);
	}

	process.stderr.write("\n");

	// Summarize
	const parts = [`Renamed ${plural(renameOk, "repo")}`];
	const alreadyRenamed = assessments.filter((a) => a.outcome === "already-on-new").length;
	if (alreadyRenamed > 0) parts.push(`${alreadyRenamed} already renamed`);
	const skipped = assessments.filter((a) => a.outcome !== "will-rename" && a.outcome !== "already-on-new").length;
	if (skipped > 0) parts.push(`${skipped} skipped`);
	if (renamedWorkspace) parts.push("workspace renamed");
	finishSummary(parts, false);

	// Guide user toward arb push when remote branches were involved
	const hasAnyRemote = assessments.some((a) => a.shareRemote !== null);
	if (hasAnyRemote) {
		info("Run 'arb push' to push the new branch name to the remote");
	}

	// Print new workspace path to stdout for shell wrapper cd
	if (renamedWorkspace && newWorkspaceName) {
		process.stdout.write(`${ctx.arbRootDir}/${newWorkspaceName}\n`);
	}
}

async function runAbort(
	wsDir: string,
	configFile: string,
	currentConfigBranch: string,
	branchRenameFrom: string | null,
	configBase: string | null,
	options: RenameOptions,
): Promise<void> {
	if (!branchRenameFrom) {
		error("No rename in progress. Nothing to abort.");
		throw new ArbError("No rename in progress. Nothing to abort.");
	}

	const oldBranch = branchRenameFrom;
	const newBranch = currentConfigBranch;

	const repoDirs = workspaceRepoDirs(wsDir);

	// Assess: classify each repo for rollback
	const assessments: AbortAssessment[] = await Promise.all(
		repoDirs.map(async (repoDir): Promise<AbortAssessment> => {
			const repo = basename(repoDir);
			const headResult = await git(repoDir, "branch", "--show-current");
			const currentBranch = headResult.exitCode === 0 ? headResult.stdout.trim() || null : null;

			if (currentBranch === newBranch) {
				return { repo, repoDir, outcome: "roll-back", currentBranch };
			}
			if (currentBranch === oldBranch) {
				return { repo, repoDir, outcome: "already-reverted", currentBranch };
			}
			return { repo, repoDir, outcome: "skip-unknown", currentBranch };
		}),
	);

	process.stderr.write(formatAbortPlan(assessments, oldBranch, newBranch));

	const toRollBack = assessments.filter((a) => a.outcome === "roll-back");
	const skipUnknown = assessments.filter((a) => a.outcome === "skip-unknown");

	if (toRollBack.length === 0) {
		// Already fully reverted — just clean up config
		writeConfig(configFile, oldBranch, configBase, null);
		success("Rename aborted — all repos already reverted");
		if (skipUnknown.length > 0) {
			warn(`${plural(skipUnknown.length, "repo")} on unexpected branch left unchanged`);
		}
		return;
	}

	if (options.dryRun) {
		dryRunNotice();
		return;
	}

	await confirmOrExit({
		yes: options.yes,
		message: `Roll back branch rename in ${plural(toRollBack.length, "repo")}?`,
	});

	process.stderr.write("\n");

	// Execute rollback
	let rollbackOk = 0;
	const failures: string[] = [];
	for (const a of toRollBack) {
		inlineStart(a.repo, "reverting");
		const result = await git(a.repoDir, "branch", "-m", newBranch, oldBranch);
		if (result.exitCode === 0) {
			inlineResult(a.repo, `reverted to ${oldBranch}`);
			rollbackOk++;
		} else {
			inlineResult(a.repo, red("failed"));
			failures.push(a.repo);
		}
	}

	process.stderr.write("\n");

	if (failures.length > 0) {
		// Leave migration state intact so --abort can be retried
		error(`Failed to revert ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
		warn("Migration state preserved — retry with 'arb branch rename --abort'");
		throw new ArbError(`Failed to revert ${plural(failures.length, "repo")}: ${failures.join(", ")}`);
	}

	// All rollbacks succeeded — restore config
	writeConfig(configFile, oldBranch, configBase, null);

	success(`Rename aborted — reverted ${plural(rollbackOk, "repo")}`);
	info("Remote branches were not modified — no remote cleanup needed");

	if (skipUnknown.length > 0) {
		warn(`${plural(skipUnknown.length, "repo")} on unexpected branch left unchanged`);
	}
}

/**
 * Compute workspace rename eligibility.
 * Returns the new workspace name, or null if no rename should happen.
 */
function resolveWorkspaceRename(
	ctx: ArbContext,
	workspace: string,
	oldBranch: string,
	newBranch: string,
	options: RenameOptions,
): string | null {
	if (options.workspaceName) {
		// Explicit workspace name — validate
		const nameErr = validateWorkspaceName(options.workspaceName);
		if (nameErr) {
			error(nameErr);
			throw new ArbError(nameErr);
		}
		if (options.workspaceName !== workspace && existsSync(`${ctx.arbRootDir}/${options.workspaceName}`)) {
			const msg = `Directory '${options.workspaceName}' already exists`;
			error(msg);
			throw new ArbError(msg);
		}
		if (options.workspaceName !== workspace) {
			return options.workspaceName;
		}
		return null;
	}

	if (options.keepWorkspaceName) {
		return null;
	}

	// Auto-derive: only when workspace name matches the old branch
	if (workspace === oldBranch) {
		const nameErr = validateWorkspaceName(newBranch);
		if (nameErr !== null) {
			warn("Workspace not renamed — branch name is not a valid workspace name");
			info("  Use --workspace-name <name> to rename it");
			return null;
		}
		if (existsSync(`${ctx.arbRootDir}/${newBranch}`)) {
			warn(`Workspace not renamed — directory '${newBranch}' already exists`);
			info("  Use --workspace-name <name> to rename to a different name");
			return null;
		}
		return newBranch;
	}

	return null;
}

export function registerBranchRenameSubcommand(parent: Command, getCtx: () => ArbContext): void {
	parent
		.command("rename [new-name]")
		.option("--continue", "Resume an in-progress rename")
		.option("--abort", "Roll back an in-progress rename")
		.option("-r, --delete-remote", "Delete old branch on remote after rename")
		.option("--fetch", "Fetch from all remotes before rename (default)")
		.option("-N, --no-fetch", "Skip fetching before rename")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("--include-in-progress", "Rename repos even if they have an in-progress git operation")
		.option("--workspace-name <name>", "Rename the workspace directory to <name>")
		.option("--keep-workspace-name", "Do not rename the workspace directory")
		.summary("Rename the workspace branch across all repos")
		.description(
			"Renames the workspace branch locally across all repos and updates .arbws/config. When the workspace directory name matches the old branch name, the workspace is also renamed to match the new branch. Use --workspace-name to specify an explicit name (useful for slashed branches like feat/foo). Use --keep-workspace-name to prevent the workspace from being renamed.\n\nFetches before assessing to get fresh remote state (use -N/--no-fetch to skip). Shows a plan and asks for confirmation before proceeding. Repos with an in-progress git operation (rebase, merge, cherry-pick) are skipped by default — use --include-in-progress to override.\n\nBranch rename is non-atomic across repos: if it fails partway, migration state is preserved in .arbws/config so the operation can be resumed. Use --continue to retry remaining repos or --abort to roll back. After rename, tracking is cleared so 'arb push' treats the branch as new and pushes under the new name. Use --delete-remote to also delete the old remote branch during rename.",
		)
		.action(async (newNameArg: string | undefined, options: RenameOptions) => {
			const ctx = getCtx();
			const { wsDir, workspace } = requireWorkspace(ctx);

			if (options.workspaceName && options.keepWorkspaceName) {
				const msg = "Cannot combine --workspace-name with --keep-workspace-name";
				error(msg);
				throw new ArbError(msg);
			}

			const configFile = `${wsDir}/.arbws/config`;
			const currentConfigBranch = configGet(configFile, "branch");
			const branchRenameFrom = configGet(configFile, "branch_rename_from");
			const configBase = configGet(configFile, "base");

			if (!currentConfigBranch) {
				const msg = `No branch configured for workspace '${workspace}'. Cannot rename.`;
				error(msg);
				throw new ArbError(msg);
			}

			if (options.abort) {
				return runAbort(wsDir, configFile, currentConfigBranch, branchRenameFrom, configBase, options);
			}

			let oldBranch: string;
			let newBranch: string;

			if (options.continue) {
				if (!branchRenameFrom) {
					error("No rename in progress. Nothing to continue.");
					throw new ArbError("No rename in progress. Nothing to continue.");
				}
				oldBranch = branchRenameFrom;
				newBranch = currentConfigBranch;
			} else {
				if (!newNameArg) {
					error("New branch name required. Usage: arb branch rename <new-name>");
					throw new ArbError("New branch name required. Usage: arb branch rename <new-name>");
				}

				if (!validateBranchName(newNameArg)) {
					error(`Invalid branch name: '${newNameArg}'`);
					throw new ArbError(`Invalid branch name: '${newNameArg}'`);
				}

				if (branchRenameFrom !== null) {
					// Migration already in progress
					if (currentConfigBranch === newNameArg) {
						// Same target — treat as resume
						oldBranch = branchRenameFrom;
						newBranch = currentConfigBranch;
					} else {
						const msg = `A rename to '${currentConfigBranch}' is already in progress — use 'arb branch rename --continue' or 'arb branch rename --abort'`;
						error(msg);
						throw new ArbError(msg);
					}
				} else {
					// Fresh run
					oldBranch = currentConfigBranch;
					newBranch = newNameArg;

					if (oldBranch === newBranch) {
						// Branch already correct — check for standalone workspace rename
						if (options.workspaceName) {
							const newWorkspaceName = resolveWorkspaceRename(ctx, workspace, oldBranch, newBranch, options);
							if (newWorkspaceName) {
								const repoDirs = workspaceRepoDirs(wsDir);
								const repos = repoDirs.map((d) => basename(d));
								if (renameWorkspace(ctx, wsDir, workspace, newWorkspaceName, repos)) {
									process.stdout.write(`${ctx.arbRootDir}/${newWorkspaceName}\n`);
								}
							}
							return;
						}
						info(`Already on branch '${newBranch}' — nothing to do`);
						return;
					}
				}
			}

			// Compute workspace rename eligibility (not during --continue or --abort)
			const newWorkspaceName =
				!options.continue && !options.abort
					? resolveWorkspaceRename(ctx, workspace, oldBranch, newBranch, options)
					: null;

			return runRename(wsDir, ctx, workspace, configFile, oldBranch, newBranch, configBase, newWorkspaceName, options);
		});
}
