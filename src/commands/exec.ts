import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { boldLine, error, plural, success } from "../lib/output";
import { collectRepo, validateRepoNames, workspaceRepoDirs } from "../lib/repos";
import { computeFlags, gatherRepoStatus, repoMatchesWhere, validateWhere } from "../lib/status";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export function registerExecCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("exec")
		.argument("<command...>", "Command to run in each worktree")
		.option("--repo <name>", "Only run in specified repos (repeatable)", collectRepo, [])
		.option("-d, --dirty", "Only run in dirty repos (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Only run in repos matching status filter (comma = OR, + = AND)")
		.passThroughOptions()
		.summary("Run a command in each worktree")
		.description(
			"Run the given command sequentially in each worktree and report which succeeded or failed. Each worktree is preceded by an ==> repo <== header. The command inherits your terminal, so interactive programs work.\n\nUse --repo <name> to target specific repos (repeatable). Use --dirty to only run in repos with local changes, or --where <filter> to filter by any status flag: dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, gone, shallow, at-risk, stale. Comma-separated values use OR logic; use + for AND (e.g. --where dirty+unpushed matches repos that are both dirty and unpushed). + binds tighter than comma: dirty+unpushed,gone = (dirty AND unpushed) OR gone. --repo and --where/--dirty can be combined (AND logic).\n\nArb flags must come before the command. Everything after the command name is passed through verbatim:\n\n  arb exec --repo api --repo web -- npm test\n  arb exec --dirty git diff -d    # --dirty → arb, -d → git diff",
		)
		.action(async (args: string[], options: { repo?: string[]; dirty?: boolean; where?: string }) => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);

			// Validate --repo names
			if (options.repo && options.repo.length > 0) {
				validateRepoNames(wsDir, options.repo);
			}

			// Resolve --dirty as shorthand for --where dirty
			if (options.dirty && options.where) {
				error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
				process.exit(1);
			}
			const where = options.dirty ? "dirty" : options.where;

			if (where) {
				const err = validateWhere(where);
				if (err) {
					error(err);
					process.exit(1);
				}
			}

			// Check if command exists in PATH
			const which = Bun.spawnSync(["which", args[0] ?? ""], { cwd: wsDir });
			if (which.exitCode !== 0) {
				error(`'${args[0]}' not found in PATH`);
				process.exit(1);
			}

			const execOk: string[] = [];
			const execFailed: string[] = [];
			const skipped: string[] = [];
			let repoDirs = workspaceRepoDirs(wsDir);

			// Filter by --repo names
			if (options.repo && options.repo.length > 0) {
				const repoSet = new Set(options.repo);
				repoDirs = repoDirs.filter((d) => repoSet.has(basename(d)));
			}

			// Pre-gather status when filtering
			const repoFilter = new Map<string, boolean>();
			if (where) {
				const workspace = ctx.currentWorkspace ?? "";
				const branch = await requireBranch(wsDir, workspace);
				const configBase = configGet(`${wsDir}/.arbws/config`, "base");
				await Promise.all(
					repoDirs.map(async (repoDir) => {
						const repo = basename(repoDir);
						const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase);
						const flags = computeFlags(status, branch);
						repoFilter.set(repo, repoMatchesWhere(flags, where));
					}),
				);
			}

			for (const repoDir of repoDirs) {
				const repo = basename(repoDir);

				if (repoFilter.size > 0 && !repoFilter.get(repo)) {
					skipped.push(repo);
					continue;
				}

				boldLine(`==> ${repo} <==`);
				const proc = Bun.spawn(args, {
					cwd: repoDir,
					stdout: "inherit",
					stderr: "inherit",
					stdin: "inherit",
				});
				const exitCode = await proc.exited;
				if (exitCode === 0) {
					execOk.push(repo);
				} else {
					execFailed.push(repo);
				}
				process.stderr.write("\n");
			}

			const parts: string[] = [];
			if (execOk.length > 0) parts.push(`Ran in ${plural(execOk.length, "repo")}`);
			if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
			if (parts.length > 0) success(parts.join(", "));
			if (execFailed.length > 0) error(`Failed: ${execFailed.join(" ")}`);

			if (execFailed.length > 0) process.exit(1);
		});
}
