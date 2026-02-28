import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { ArbError } from "../lib/errors";
import { GitCache } from "../lib/git-cache";
import { error, plural, success } from "../lib/output";
import { writeRepoHeaderSimple } from "../lib/repo-header";
import { collectRepo, validateRepoNames, workspaceRepoDirs } from "../lib/repos";
import { computeFlags, gatherRepoStatus, repoMatchesWhere, resolveWhereFilter } from "../lib/status";
import type { ArbContext } from "../lib/types";
import { requireBranch, requireWorkspace } from "../lib/workspace-context";

export function registerExecCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("exec")
		.argument("<command...>", "Command to run in each repo")
		.option("--repo <name>", "Only run in specified repos (repeatable)", collectRepo, [])
		.option("-d, --dirty", "Only run in dirty repos (shorthand for --where dirty)")
		.option("-w, --where <filter>", "Only run in repos matching status filter (comma = OR, + = AND, ^ = negate)")
		.passThroughOptions()
		.summary("Run a command in each repo")
		.description(
			"Run the given command sequentially in each repo and report which succeeded or failed. Each repo is preceded by an ==> repo <== header. The command inherits your terminal, so interactive programs work.\n\nUse --repo <name> to target specific repos (repeatable). Use --dirty to only run in repos with local changes, or --where <filter> to filter by status flags. See 'arb help where' for filter syntax. --repo and --where/--dirty can be combined (AND logic).\n\nArb flags must come before the command. Everything after the command name is passed through verbatim:\n\n  arb exec --repo api --repo web -- npm test\n  arb exec --dirty git diff -d    # --dirty → arb, -d → git diff",
		)
		.action(async (args: string[], options: { repo?: string[]; dirty?: boolean; where?: string }) => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);

			// Validate --repo names
			if (options.repo && options.repo.length > 0) {
				validateRepoNames(wsDir, options.repo);
			}

			const where = resolveWhereFilter(options);

			// Check if command exists in PATH
			const which = Bun.spawnSync(["which", args[0] ?? ""], { cwd: wsDir });
			if (which.exitCode !== 0) {
				error(`'${args[0]}' not found in PATH`);
				throw new ArbError(`'${args[0]}' not found in PATH`);
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
				const cache = new GitCache();
				await Promise.all(
					repoDirs.map(async (repoDir) => {
						const repo = basename(repoDir);
						const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, undefined, cache);
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

				writeRepoHeaderSimple(repo);
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

			if (execFailed.length > 0) throw new ArbError("Command failed in some repos");
		});
}
