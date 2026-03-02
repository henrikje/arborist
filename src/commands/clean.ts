import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import { loadArbIgnore } from "../lib/arbignore";
import { findOrphanedBranches, findStaleWorktrees, pruneWorktrees } from "../lib/clean";
import { ArbAbort, ArbError } from "../lib/errors";
import { git } from "../lib/git";
import { GitCache } from "../lib/git-cache";
import { dryRunNotice, error, info, plural, skipConfirmNotice, success, yellow } from "../lib/output";
import { listNonWorkspaces, listWorkspaces, selectInteractive } from "../lib/repos";
import { renderTable } from "../lib/table";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";

function describeContents(dirPath: string): string {
	const entries = readdirSync(dirPath);
	if (entries.length === 0) return "empty";
	if (entries.length === 1) {
		const entry = entries[0];
		if (!entry) return "empty";
		const isDir = statSync(join(dirPath, entry)).isDirectory();
		return `only ${entry}${isDir ? "/" : ""}`;
	}
	return `${entries.length} items`;
}

export function registerCleanCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("clean [names...]")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --dry-run", "Show what would happen without executing")
		.option("-f, --force", "Delete unmerged orphaned branches (by default only merged branches are deleted)")
		.summary("Clean up non-workspace directories and stale git state")
		.description(
			"Remove non-workspace directories, prune stale worktree references, and delete orphaned local branches from canonical repos.\n\nNon-workspace directories are top-level directories that lack .arbws/ — typically shell directories left behind by editors that recreate a directory after deletion (e.g. IntelliJ writing .idea/ on close). Use positional arguments to target specific directories, or run without arguments to scan and select interactively.\n\nStale worktree references and orphaned branches accumulate when workspace directories are manually removed or when arb delete partially fails. arb clean detects and removes both.\n\nCreate a .arbignore file in the arb root to exclude directories from cleanup. List one directory name per line; lines starting with # are comments.",
		)
		.action(async (nameArgs: string[], options: { yes?: boolean; dryRun?: boolean; force?: boolean }) => {
			const ctx = getCtx();
			const skipPrompts = options.yes ?? false;
			const forceOrphans = options.force ?? false;

			// ── Section 1: Non-workspace directories ─────────────────
			const ignored = loadArbIgnore(ctx.arbRootDir);
			const allNonWorkspacesUnfiltered = listNonWorkspaces(ctx.arbRootDir);
			const allNonWorkspaces = listNonWorkspaces(ctx.arbRootDir, ignored);
			const ignoredCount = allNonWorkspacesUnfiltered.length - allNonWorkspaces.length;

			// Validate positional args
			let targetDirs: string[];
			if (nameArgs.length > 0) {
				for (const name of nameArgs) {
					if (existsSync(join(ctx.arbRootDir, name, ".arbws"))) {
						error(`'${name}' is a workspace. Use 'arb delete ${name}' instead.`);
						throw new ArbError(`'${name}' is a workspace. Use 'arb delete ${name}' instead.`);
					}
					if (!allNonWorkspacesUnfiltered.includes(name)) {
						if (!existsSync(join(ctx.arbRootDir, name))) {
							const msg = `Directory '${name}' does not exist.`;
							error(msg);
							throw new ArbError(msg);
						}
						const msg = `Directory '${name}' is not a non-workspace directory.`;
						error(msg);
						throw new ArbError(msg);
					}
				}
				targetDirs = nameArgs;
			} else {
				targetDirs = allNonWorkspaces;
			}

			// ── Section 2: Stale worktree references (detect only) ───
			const staleWorktreeRepos = await findStaleWorktrees(ctx.reposDir);

			// ── Section 3: Orphaned local branches ───────────────────
			const workspaces = listWorkspaces(ctx.arbRootDir);
			const workspaceBranches = new Set<string>();
			for (const ws of workspaces) {
				const wb = await workspaceBranch(join(ctx.arbRootDir, ws));
				if (wb) workspaceBranches.add(wb.branch);
			}
			const cache = new GitCache();
			const orphanedBranches = await findOrphanedBranches(ctx.reposDir, workspaceBranches, cache);

			// ── Check if there's anything to do ──────────────────────
			const hasDirs = targetDirs.length > 0;
			const hasStale = staleWorktreeRepos.length > 0;
			const hasOrphans = orphanedBranches.length > 0;

			if (!hasDirs && !hasStale && !hasOrphans) {
				info("Nothing to clean up.");
				return;
			}

			// ── Display findings ─────────────────────────────────────
			if (hasDirs) {
				// Build table
				const descriptions: string[] = targetDirs.map((name) => describeContents(join(ctx.arbRootDir, name)));

				const tableRows = targetDirs.map((name, i) => ({ name, contents: descriptions[i] ?? "" }));
				process.stderr.write("\n");
				process.stderr.write(
					renderTable(
						[
							{ header: "DIRECTORY", value: (r) => r.name },
							{ header: "CONTENTS", value: (r) => r.contents },
						],
						tableRows,
					),
				);
				process.stderr.write("\n");

				if (ignoredCount > 0 && nameArgs.length === 0) {
					info(`  ${plural(ignoredCount, "directory", "directories")} excluded by .arbignore`);
					process.stderr.write("\n");
				}
			}

			if (hasStale) {
				info("  Stale worktree references:");
				for (const repo of staleWorktreeRepos) {
					info(`    ${repo}`);
				}
				process.stderr.write("\n");
			}

			if (hasOrphans) {
				info("  Orphaned branches:");
				const byRepo = new Map<string, { branch: string; mergeStatus: "merged" | "unmerged"; aheadCount: number }[]>();
				for (const ob of orphanedBranches) {
					const list = byRepo.get(ob.repo) ?? [];
					list.push(ob);
					byRepo.set(ob.repo, list);
				}
				for (const [repo, entries] of byRepo) {
					const labels = entries.map((e) => {
						if (e.mergeStatus === "merged") return `${e.branch} (merged)`;
						return `${e.branch} ${yellow(`(${e.aheadCount} ahead)`)}`;
					});
					info(`    ${repo}: ${labels.join(", ")}`);
				}
				process.stderr.write("\n");
			}

			if (options.dryRun) {
				dryRunNotice();
				return;
			}

			// ── Interactive selection (TTY, no positional args, dirs only) ──
			let selectedDirs = targetDirs;
			if (hasDirs && nameArgs.length === 0 && !skipPrompts) {
				if (!isTTY() || !process.stdin.isTTY) {
					error("Not a terminal. Use --yes to skip confirmation.");
					throw new ArbError("Not a terminal. Use --yes to skip confirmation.");
				}
				selectedDirs = await selectInteractive(targetDirs, "Select directories to remove");
				if (selectedDirs.length === 0 && !hasStale && !hasOrphans) {
					info("Nothing selected.");
					return;
				}
			}

			// ── Split orphaned branches by merge status ─────────────
			const mergedOrphans = orphanedBranches.filter((ob) => ob.mergeStatus === "merged");
			const unmergedOrphans = orphanedBranches.filter((ob) => ob.mergeStatus === "unmerged");
			const orphansToDelete = forceOrphans ? orphanedBranches : mergedOrphans;
			const hasOrphansToDelete = orphansToDelete.length > 0;

			// ── Confirm ──────────────────────────────────────────────
			if (!skipPrompts) {
				if (!isTTY() || !process.stdin.isTTY) {
					error("Not a terminal. Use --yes to skip confirmation.");
					throw new ArbError("Not a terminal. Use --yes to skip confirmation.");
				}

				const parts: string[] = [];
				if (selectedDirs.length > 0) parts.push(`remove ${plural(selectedDirs.length, "directory", "directories")}`);
				if (hasStale) parts.push(`prune ${plural(staleWorktreeRepos.length, "stale worktree ref")}`);
				if (hasOrphansToDelete)
					parts.push(`delete ${plural(orphansToDelete.length, "orphaned branch", "orphaned branches")}`);

				if (parts.length === 0) {
					if (unmergedOrphans.length > 0 && !forceOrphans) {
						info(
							`${plural(unmergedOrphans.length, "unmerged orphaned branch", "unmerged orphaned branches")} skipped (use --force to delete)`,
						);
					}
					info("Nothing to do.");
					return;
				}

				const shouldProceed = await confirm(
					{
						message: `${parts.join(" and ")}?`,
						default: false,
					},
					{ output: process.stderr },
				);
				if (!shouldProceed) {
					throw new ArbAbort();
				}
			} else {
				skipConfirmNotice("--yes");
			}

			// ── Execute ──────────────────────────────────────────────
			for (const name of selectedDirs) {
				rmSync(join(ctx.arbRootDir, name), { recursive: true, force: true });
			}

			if (hasStale) {
				await pruneWorktrees(ctx.reposDir);
			}

			for (const ob of orphansToDelete) {
				// Use -D for all: our detectBranchMerged is smarter than git's -d
				// (it detects squash merges via patch-id, which git -d would reject)
				await git(join(ctx.reposDir, ob.repo), "branch", "-D", ob.branch);
			}

			// ── Summary ──────────────────────────────────────────────
			const summaryParts: string[] = [];
			if (selectedDirs.length > 0)
				summaryParts.push(`Removed ${plural(selectedDirs.length, "directory", "directories")}`);
			if (hasStale) summaryParts.push(`pruned ${plural(staleWorktreeRepos.length, "repo")}`);
			if (orphansToDelete.length > 0)
				summaryParts.push(`deleted ${plural(orphansToDelete.length, "orphaned branch", "orphaned branches")}`);
			success(summaryParts.join(", "));

			// Hint about skipped unmerged branches
			if (unmergedOrphans.length > 0 && !forceOrphans) {
				info(
					`${plural(unmergedOrphans.length, "unmerged orphaned branch", "unmerged orphaned branches")} skipped (use --force to delete)`,
				);
			}
		});
}
