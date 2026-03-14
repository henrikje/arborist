import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, readWorkspaceConfig } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache } from "../lib/git";
import { type RenderContext, render } from "../lib/render";
import { repoHeaderNode } from "../lib/render";
import { computeFlags, gatherRepoStatus, repoMatchesWhere, resolveWhereFilter } from "../lib/status";
import { error, isTTY, plural, success } from "../lib/terminal";
import { collectRepo, requireBranch, requireWorkspace, validateRepoNames, workspaceRepoDirs } from "../lib/workspace";

export function registerExecCommand(program: Command, getCtx: () => ArbContext): void {
  program
    .command("exec")
    .argument("<command...>", "Command to run in each repo")
    .option("--repo <name>", "Only run in specified repos (repeatable)", collectRepo, [])
    .option("-d, --dirty", "Only run in dirty repos (shorthand for --where dirty)")
    .option("-w, --where <filter>", "Only run in repos matching status filter (comma = OR, + = AND, ^ = negate)")
    .option("-p, --parallel", "Run command in all repos concurrently (disables stdin)")
    .passThroughOptions()
    .summary("Run a command in each repo")
    .description(
      "Run the given command in each repo and report which succeeded or failed. Each repo is preceded by an ==> repo <== header. By default, commands run sequentially and inherit your terminal, so interactive programs work.\n\nUse --parallel (-p) to run concurrently across all repos. Output is buffered per repo and printed in alphabetical order. Stdin is disabled in parallel mode.\n\nUse --repo <name> to target specific repos (repeatable). Use --dirty to only run in repos with local changes, or --where <filter> to filter by status flags. See 'arb help where' for filter syntax. --repo and --where/--dirty can be combined (AND logic).\n\nArb flags must come before the command. Everything after the command name is passed through verbatim:\n\n  arb exec --repo api --repo web -- npm test\n  arb exec --dirty git diff -d    # --dirty → arb, -d → git diff\n  arb exec -p npm install          # parallel install across all repos",
    )
    .action(
      async (args: string[], options: { repo?: string[]; dirty?: boolean; where?: string; parallel?: boolean }) => {
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
          const configBase = readWorkspaceConfig(`${wsDir}/.arbws/config.json`)?.base ?? null;
          const cache = await GitCache.create();
          await Promise.all(
            repoDirs.map(async (repoDir) => {
              const repo = basename(repoDir);
              const status = await gatherRepoStatus(repoDir, ctx.reposDir, configBase, undefined, cache);
              const flags = computeFlags(status, branch);
              repoFilter.set(repo, repoMatchesWhere(flags, where));
            }),
          );
        }

        // Apply where filter
        const filteredDirs: string[] = [];
        for (const repoDir of repoDirs) {
          const repo = basename(repoDir);
          if (repoFilter.size > 0 && !repoFilter.get(repo)) {
            skipped.push(repo);
          } else {
            filteredDirs.push(repoDir);
          }
        }

        const renderCtx: RenderContext = { tty: isTTY() };

        if (options.parallel) {
          const result = await runParallelExec(filteredDirs, args, renderCtx);
          execOk.push(...result.execOk);
          execFailed.push(...result.execFailed);
        } else {
          for (const repoDir of filteredDirs) {
            const repo = basename(repoDir);
            process.stderr.write(render([repoHeaderNode(repo)], renderCtx));
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
        }

        const parts: string[] = [];
        if (execOk.length > 0) parts.push(`Ran in ${plural(execOk.length, "repo")}`);
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        if (execFailed.length > 0) parts.push(`${execFailed.length} failed`);
        if (parts.length > 0) {
          if (execFailed.length > 0) {
            error(parts.join(", "));
          } else {
            success(parts.join(", "));
          }
        }

        if (execFailed.length > 0) throw new ArbError("Command failed in some repos");
      },
    );
}

async function runParallelExec(
  repoDirs: string[],
  args: string[],
  renderCtx: RenderContext,
): Promise<{ execOk: string[]; execFailed: string[] }> {
  const total = repoDirs.length;
  const tty = renderCtx.tty;

  // State for streaming in-order output
  let nextToEmit = 0;
  let completed = 0;
  const results = new Map<number, { repo: string; exitCode: number; stdout: Buffer; stderr: Buffer }>();

  const execOk: string[] = [];
  const execFailed: string[] = [];

  const updateProgress = () => {
    if (tty) {
      process.stderr.write(`\r\x1B[2KRunning ${plural(total, "repo")}... ${completed}/${total}`);
    }
  };

  const flushReady = () => {
    let r = results.get(nextToEmit);
    while (r) {
      if (tty) process.stderr.write("\r\x1B[2K"); // clear progress line

      // Write repo header to stderr
      process.stderr.write(render([repoHeaderNode(r.repo)], renderCtx));
      // Write captured stdout to stdout
      if (r.stdout.length > 0) process.stdout.write(r.stdout);
      // Write captured stderr to stderr
      if (r.stderr.length > 0) process.stderr.write(r.stderr);
      process.stderr.write("\n");

      if (r.exitCode === 0) {
        execOk.push(r.repo);
      } else {
        execFailed.push(r.repo);
      }

      results.delete(nextToEmit);
      nextToEmit++;

      // Re-show progress if more repos are pending
      if (nextToEmit < total && completed < total) {
        updateProgress();
      }

      r = results.get(nextToEmit);
    }
  };

  const startTime = performance.now();
  updateProgress();

  await Promise.all(
    repoDirs.map(async (repoDir, index) => {
      const repo = basename(repoDir);

      const proc = Bun.spawn(args, {
        cwd: repoDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      const [stdoutBuf, stderrBuf] = await Promise.all([
        new Response(proc.stdout).arrayBuffer().then((b) => Buffer.from(b)),
        new Response(proc.stderr).arrayBuffer().then((b) => Buffer.from(b)),
      ]);
      await proc.exited;
      const exitCode = proc.exitCode ?? 1;

      completed++;
      results.set(index, { repo, exitCode, stdout: stdoutBuf, stderr: stderrBuf });

      updateProgress();
      flushReady();
    }),
  );

  // Clear progress / print elapsed time
  if (tty) {
    process.stderr.write("\r\x1B[2K");
  } else {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    process.stderr.write(`Ran ${plural(total, "repo")} in ${elapsed}s\n`);
  }

  // Flush any remaining (safety net)
  flushReady();

  return { execOk, execFailed };
}
