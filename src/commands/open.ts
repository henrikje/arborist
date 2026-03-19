import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, arbAction, readWorkspaceConfig } from "../lib/core";
import { computeFlags, gatherRepoStatus, repoMatchesWhere, resolveWhereFilter } from "../lib/status";
import { error, info } from "../lib/terminal";
import { collectRepo, requireBranch, requireWorkspace, validateRepoNames, workspaceRepoDirs } from "../lib/workspace";

export function registerOpenCommand(program: Command): void {
  program
    .command("open")
    .argument("<command...>", "Command to open repos with")
    .option("--repo <name>", "Only open specified repos (repeatable)", collectRepo, [])
    .option("-d, --dirty", "Only open dirty repos (shorthand for --where dirty)")
    .option("-w, --where <filter>", "Only open repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .passThroughOptions()
    .summary("Open repos in an editor or tool")
    .description(
      "Examples:\n\n  arb open code                            Open all repos in VS Code\n  arb open --dirty code -n --add           Open only dirty repos in new window\n\nRun a command with all repo directories as arguments, using absolute paths. Useful for opening repos in an editor, e.g. \"arb open code\". The command must exist in your PATH.\n\nUse --repo <name> to target specific repos (repeatable). Use --dirty to only open repos with local changes, or --where <filter> to filter by status flags. See 'arb help filtering' for filter syntax. --repo and --where/--dirty can be combined (AND logic).\n\nArb flags must come before the command. Everything after the command name is passed through verbatim.",
    )
    .action(
      arbAction(async (ctx, args: string[], options) => {
        const [command = "", ...extraFlags] = args;
        const { wsDir } = requireWorkspace(ctx);

        // Validate --repo names
        if (options.repo && options.repo.length > 0) {
          validateRepoNames(wsDir, options.repo);
        }

        const where = resolveWhereFilter(options);

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
          const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;
          const cache = ctx.cache;
          await Promise.all(
            repoDirs.map(async (repoDir) => {
              const status = await gatherRepoStatus(
                repoDir,
                ctx.reposDir,
                configBase,
                undefined,
                cache,
                ctx.analysisCache,
              );
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
      }),
    );
}
