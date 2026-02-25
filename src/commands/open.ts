import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { ArbError } from "../lib/errors";
import { error, info } from "../lib/output";
import { collectRepo, validateRepoNames, workspaceRepoDirs } from "../lib/repos";
import { computeFlags, gatherRepoStatus, repoMatchesWhere, validateWhere } from "../lib/status";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export function registerOpenCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("open")
		.argument("<command...>", "Command to open repos with")
		.option("--repo <name>", "Only open specified repos (repeatable)", collectRepo, [])
		.option("-d, --dirty", "Only open dirty repos (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Only open repos matching status filter (comma = OR, + = AND, ^ = negate)")
		.passThroughOptions()
		.summary("Open repos in an application")
		.description(
			'Run a command with all repo directories as arguments, using absolute paths. Useful for opening repos in an editor, e.g. "arb open code". The command must exist in your PATH.\n\nUse --repo <name> to target specific repos (repeatable). Use --dirty to only open repos with local changes, or --where <filter> to filter by any status flag: dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, gone, shallow, merged, base-merged, base-missing, at-risk, stale. Positive/healthy terms: clean, pushed, synced-base, synced-share, synced, safe. Prefix any term with ^ to negate (e.g. --where ^dirty is equivalent to --where clean). Comma-separated values use OR logic; use + for AND (e.g. --where dirty+unpushed matches repos that are both dirty and unpushed). + binds tighter than comma: dirty+unpushed,gone = (dirty AND unpushed) OR gone. --repo and --where/--dirty can be combined (AND logic).\n\nArb flags must come before the command. Everything after the command name is passed through verbatim:\n\n  arb open --repo api --repo web code\n  arb open --dirty code -n --add    # --dirty → arb, -n --add → code',
		)
		.action(async (args: string[], options: { repo?: string[]; dirty?: boolean; where?: string }) => {
			const [command = "", ...extraFlags] = args;
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);

			// Validate --repo names
			if (options.repo && options.repo.length > 0) {
				validateRepoNames(wsDir, options.repo);
			}

			// Resolve --dirty as shorthand for --where dirty
			if (options.dirty && options.where) {
				error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
				throw new ArbError("Cannot combine --dirty with --where. Use --where dirty,... instead.");
			}
			const where = options.dirty ? "dirty" : options.where;

			if (where) {
				const err = validateWhere(where);
				if (err) {
					error(err);
					throw new ArbError(err);
				}
			}

			// Check if command exists in PATH
			const which = Bun.spawnSync(["which", command], { cwd: wsDir });
			if (which.exitCode !== 0) {
				error(`'${command}' not found in PATH`);
				throw new ArbError(`'${command}' not found in PATH`);
			}

			let repoDirs = workspaceRepoDirs(wsDir);

			// Filter by --repo names
			if (options.repo && options.repo.length > 0) {
				const repoSet = new Set(options.repo);
				repoDirs = repoDirs.filter((d) => repoSet.has(basename(d)));
			}

			const dirsToOpen: string[] = [];

			if (where) {
				const workspace = ctx.currentWorkspace ?? "";
				const branch = await requireBranch(wsDir, workspace);
				const configBase = configGet(`${wsDir}/.arbws/config`, "base");
				await Promise.all(
					repoDirs.map(async (repoDir) => {
						const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase);
						const flags = computeFlags(status, branch);
						if (repoMatchesWhere(flags, where)) {
							dirsToOpen.push(repoDir);
						}
					}),
				);
				// Preserve original order
				dirsToOpen.sort((a, b) => repoDirs.indexOf(a) - repoDirs.indexOf(b));
			} else {
				dirsToOpen.push(...repoDirs);
			}

			if (dirsToOpen.length === 0) {
				if (where) {
					info("No repos match the filter");
				} else {
					info("No repos in workspace");
				}
				return;
			}

			const proc = Bun.spawn([command, ...extraFlags, ...dirsToOpen], {
				cwd: wsDir,
				stdout: "inherit",
				stderr: "inherit",
				stdin: "inherit",
			});
			await proc.exited;
		});
}
