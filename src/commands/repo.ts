import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { ArbError, arbAction, readProjectConfig, writeProjectConfig } from "../lib/core";
import { gitLocal, gitNetwork, networkTimeout } from "../lib/git";
import { printSchema } from "../lib/json";
import { type RepoListJsonEntry, RepoListJsonEntrySchema } from "../lib/json";
import { type RenderContext, render } from "../lib/render";
import { cell } from "../lib/render";
import type { OutputNode } from "../lib/render";
import { classifyNetworkError, confirmOrExit, networkErrorHint } from "../lib/sync";
import {
  dim,
  dryRunNotice,
  error,
  info,
  inlineResult,
  inlineStart,
  plural,
  shouldColor,
  success,
} from "../lib/terminal";
import { findRepoUsage, listRepos, selectInteractive } from "../lib/workspace";

function buildRepoListNodes(entries: RepoListJsonEntry[], verbose: boolean): OutputNode[] {
  const rows = entries.map((e) => {
    const notResolved = !e.share.name && !e.base.name;

    let baseText: string;
    let baseAttention: boolean;
    if (verbose) {
      baseText = e.base.name ? `${e.base.name} (${e.base.url})` : "(remotes not resolved)";
      baseAttention = !e.base.name;
    } else {
      baseText = e.base.name || "(remotes not resolved)";
      baseAttention = !e.base.name;
    }

    let shareText: string;
    let shareAttention: boolean;
    if (verbose) {
      shareText = notResolved
        ? "(remotes not resolved)"
        : e.share.name === e.base.name
          ? e.share.name
          : `${e.share.name} (${e.share.url})`;
      shareAttention = notResolved;
    } else {
      shareText = notResolved ? "(remotes not resolved)" : e.share.name;
      shareAttention = notResolved;
    }

    return {
      cells: {
        repo: cell(e.name),
        base: cell(baseText, baseAttention ? "attention" : "default"),
        share: cell(shareText, shareAttention ? "attention" : "default"),
      },
    };
  });

  return [
    {
      kind: "table",
      columns: [
        { header: "REPO", key: "repo" },
        { header: "BASE", key: "base" },
        { header: "SHARE", key: "share" },
      ],
      rows,
    },
  ];
}

export function registerRepoCommand(program: Command): void {
  const repo = program
    .command("repo")
    .summary("Clone and manage project repos")
    .description(
      "Examples:\n\n  arb repo                                 List cloned repos (default)\n  arb repo clone git@github.com:org/api    Clone a new repo\n  arb repo remove api                      Remove a repo\n\nManage the canonical repository clones in .arb/repos/. These permanent clones are never worked in directly — instead, arb creates worktrees that point back to them. Use subcommands to clone new repos, list existing ones, or remove repos that are no longer needed.\n\nSee 'arb help remotes' for remote role resolution.",
    );

  // ── repo clone ──────────────────────────────────────────────────

  repo
    .command("clone <url> [name]")
    .option("--upstream <url>", "Add an upstream remote (for fork workflows)")
    .summary("Clone a repo into .arb/repos/")
    .description(
      "Examples:\n\n  arb repo clone git@github.com:org/api\n  arb repo clone git@github.com:org/api backend\n  arb repo clone git@github.com:me/api --upstream git@github.com:org/api\n\nClone a git repository into .arb/repos/<name> as a canonical copy. These permanent clones are never worked in directly — instead, arb creates worktrees that point back to them. The repo name is derived from the URL if not specified.\n\nFor fork workflows, use --upstream to add the canonical repo as an upstream remote. This sets remote.pushDefault so arb knows to push to origin (your fork) and rebase onto upstream.",
    )
    .action(
      arbAction(async (ctx, url: string, nameArg: string | undefined, options) => {
        const repoName = nameArg || basename(url).replace(/\.git$/, "");

        if (!repoName) {
          error("Could not derive repo name from URL. Specify one: arb repo clone <url> <name>");
          throw new ArbError("Could not derive repo name from URL. Specify one: arb repo clone <url> <name>");
        }

        const target = `${ctx.reposDir}/${repoName}`;
        if (existsSync(target)) {
          error(`${repoName} is already cloned`);
          throw new ArbError(`${repoName} is already cloned`);
        }

        const cloneTimeout = networkTimeout("ARB_CLONE_TIMEOUT", 300);
        const result = await gitNetwork(target, cloneTimeout, ["clone", url, target], { cwd: ctx.reposDir });
        if (result.exitCode !== 0) {
          if (result.exitCode === 124) {
            // Clean up partial clone on timeout
            if (existsSync(target)) rmSync(target, { recursive: true, force: true });
          }
          const errMsg = result.exitCode === 124 ? result.stderr : result.stderr.trim();
          const hint = networkErrorHint(classifyNetworkError(errMsg));
          error(`Clone failed: ${errMsg}${hint ? ` (${hint})` : ""}`);
          throw new ArbError(`Clone failed: ${errMsg}`);
        }

        await gitLocal(target, "checkout", "--detach");

        if (options.upstream) {
          // Add upstream remote
          const addResult = await gitLocal(target, "remote", "add", "upstream", options.upstream);
          if (addResult.exitCode !== 0) {
            error(`Failed to add upstream remote: ${addResult.stderr.trim()}`);
            info(`  Add it manually: git -C ${target} remote add upstream ${options.upstream}`);
            throw new ArbError(`Failed to add upstream remote: ${addResult.stderr.trim()}`);
          }

          // Set remote.pushDefault so resolveRemotes() detects the fork layout
          await gitLocal(target, "config", "remote.pushDefault", "origin");

          // Fetch upstream and auto-detect HEAD
          const fetchTimeout = networkTimeout("ARB_FETCH_TIMEOUT", 120);
          const fetchResult = await gitNetwork(target, fetchTimeout, ["fetch", "upstream"]);
          if (fetchResult.exitCode !== 0) {
            const fetchErr = fetchResult.stderr.trim();
            const fetchHint = networkErrorHint(classifyNetworkError(fetchErr));
            error(`Failed to fetch upstream: ${fetchErr}${fetchHint ? ` (${fetchHint})` : ""}`);
            info(`  Retry manually: git -C ${target} fetch upstream`);
            throw new ArbError(`Failed to fetch upstream: ${fetchErr}`);
          }
          await gitLocal(target, "remote", "set-head", "upstream", "--auto");

          info(`  share: origin (${url})`);
          info(`  base:  upstream (${options.upstream})`);
          success(`Cloned repo ${repoName}`);
        } else {
          success(`Cloned repo ${repoName}`);
        }
      }),
    );

  // ── repo list ───────────────────────────────────────────────────

  repo
    .command("list", { isDefault: true })
    .option("-q, --quiet", "Output one repo name per line")
    .option("-v, --verbose", "Show remote URLs alongside names")
    .option("--json", "Output structured JSON")
    .option("--schema", "Print JSON Schema for this command's --json output and exit")
    .summary("List cloned repos (default)")
    .description(
      "Examples:\n\n  arb repo list                            List repos with remote roles\n  arb repo list -v                         Include remote URLs\n  arb repo list -q                         One name per line\n\nList all repositories that have been cloned into .arb/repos/. Shows resolved SHARE and BASE remote names for each repo. Use --verbose to include remote URLs alongside names. Use --quiet for plain enumeration (one name per line). Use --json for machine-readable output.",
    )
    .action(async (options, command) => {
      if (options.schema) {
        if (options.json || options.quiet || options.verbose) {
          error("Cannot combine --schema with --json, --quiet, or --verbose.");
          throw new ArbError("Cannot combine --schema with --json, --quiet, or --verbose.");
        }
        printSchema(z.array(RepoListJsonEntrySchema));
        return;
      }
      await arbAction(async (ctx, options) => {
        if (options.quiet && options.json) {
          error("Cannot combine --quiet with --json.");
          throw new ArbError("Cannot combine --quiet with --json.");
        }
        if (options.quiet && options.verbose) {
          error("Cannot combine --quiet with --verbose.");
          throw new ArbError("Cannot combine --quiet with --verbose.");
        }
        if (options.verbose && options.json) {
          error("Cannot combine --verbose with --json.");
          throw new ArbError("Cannot combine --verbose with --json.");
        }

        const repos = listRepos(ctx.reposDir);
        if (repos.length === 0) return;

        // Quiet output — skip URL resolution for speed
        if (options.quiet) {
          for (const r of repos) {
            process.stdout.write(`${r}\n`);
          }
          return;
        }

        const cache = ctx.cache;
        const entries: RepoListJsonEntry[] = await Promise.all(
          repos.map(async (r) => {
            const repoDir = `${ctx.reposDir}/${r}`;
            let shareName = "";
            let shareUrl = "";
            let baseName = "";
            let baseUrl = "";
            try {
              const remotes = await cache.resolveRemotes(repoDir);
              shareName = remotes.share;
              baseName = remotes.base;
              const sUrl = await cache.getRemoteUrl(repoDir, remotes.share);
              shareUrl = sUrl ?? "";
              baseUrl =
                remotes.base === remotes.share ? shareUrl : ((await cache.getRemoteUrl(repoDir, remotes.base)) ?? "");
            } catch {
              // Ambiguous remotes — fall back to origin URL with warning
              const url = await cache.getRemoteUrl(repoDir, "origin");
              shareUrl = url ?? "";
              baseUrl = url ?? "";
            }
            return {
              name: r,
              url: shareUrl,
              share: { name: shareName, url: shareUrl },
              base: { name: baseName, url: baseUrl },
            };
          }),
        );

        // JSON output
        if (options.json) {
          process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
          return;
        }

        const nodes = buildRepoListNodes(entries, options.verbose ?? false);
        const rCtx: RenderContext = { tty: shouldColor() };
        process.stdout.write(render(nodes, rCtx));
      })(options, command);
    });

  // ── repo remove ────────────────────────────────────────────────

  repo
    .command("remove [names...]")
    .option("-a, --all-repos", "Remove all canonical repos")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would be removed without removing")
    .summary("Remove canonical repos from .arb/repos/")
    .description(
      "Examples:\n\n  arb repo remove api                      Remove a single repo\n  arb repo remove api web --yes            Remove multiple, skip prompt\n  arb repo remove --all-repos              Remove all repos\n\nRemove one or more canonical repository clones from .arb/repos/ and their associated template files from .arb/templates/repos/. This is the inverse of 'arb repo clone'.\n\nRefuses to remove repos that are attached to a workspace. Run 'arb detach <repo>' or 'arb delete <workspace>' first, then retry. Prompts with a repo picker when run without arguments.",
    )
    .action(
      arbAction(async (ctx, nameArgs: string[], options) => {
        const allRepos = listRepos(ctx.reposDir);

        let repos = nameArgs;
        if (options.allRepos) {
          if (allRepos.length === 0) {
            error("No repos to remove.");
            throw new ArbError("No repos to remove.");
          }
          repos = allRepos;
        } else if (repos.length === 0) {
          if (!process.stdin.isTTY) {
            error("No repos specified. Pass repo names or use --all-repos.");
            throw new ArbError("No repos specified. Pass repo names or use --all-repos.");
          }
          if (allRepos.length === 0) {
            error("No repos to remove.");
            throw new ArbError("No repos to remove.");
          }
          repos = await selectInteractive(allRepos, "Select repos to remove");
          if (repos.length === 0) {
            error("No repos selected.");
            throw new ArbError("No repos selected.");
          }
        }

        // Validate all repos exist
        for (const name of repos) {
          if (!allRepos.includes(name)) {
            error(`Repo '${name}' is not cloned.`);
            throw new ArbError(`Repo '${name}' is not cloned.`);
          }
        }

        // Check workspace usage — hard refuse if any repo is in use
        for (const name of repos) {
          const usedBy = findRepoUsage(ctx.arbRootDir, name);
          if (usedBy.length > 0) {
            error(
              `Cannot remove ${name} — used by ${usedBy.length === 1 ? "workspace" : "workspaces"}: ${usedBy.join(", ")}`,
            );
            info(`  Run 'arb detach ${name}' in each workspace, or 'arb delete <workspace>' first.`);
            throw new ArbError(
              `Cannot remove ${name} — used by ${usedBy.length === 1 ? "workspace" : "workspaces"}: ${usedBy.join(", ")}`,
            );
          }
        }

        // Display plan
        const removeCache = ctx.cache;
        process.stderr.write("\n");
        for (const name of repos) {
          const repoDir = `${ctx.reposDir}/${name}`;
          const url = await removeCache.getRemoteUrl(repoDir, "origin");
          info(`  ${name}${url ? `  ${dim(url)}` : ""}`);
        }
        process.stderr.write("\n");

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        // Confirm
        await confirmOrExit({ yes: options.yes, message: `Remove ${plural(repos.length, "repo")}?` });

        // Execute
        process.stderr.write("\n");
        for (const name of repos) {
          inlineStart(name, "removing");
          rmSync(`${ctx.reposDir}/${name}`, { recursive: true, force: true });
          const templateDir = join(ctx.arbRootDir, ".arb", "templates", "repos", name);
          if (existsSync(templateDir)) {
            rmSync(templateDir, { recursive: true, force: true });
          }
          inlineResult(name, "removed");
        }

        // Summarize
        process.stderr.write("\n");
        success(`Removed ${plural(repos.length, "repo")}`);
      }),
    );

  // ── repo default ────────────────────────────────────────────────

  repo
    .command("default [names...]")
    .option("-r, --remove", "Remove repos from defaults")
    .summary("Manage default repo selection")
    .description(
      "Examples:\n\n  arb repo default                         List current defaults\n  arb repo default api web                 Add repos to defaults\n  arb repo default --remove api            Remove from defaults\n\nMark repos as defaults for workspace creation. Default repos are pre-selected in interactive pickers and used as the fallback repo set when no repos are specified in non-interactive mode.\n\nWith no arguments, lists current defaults. With repo names, adds them to defaults. With --remove, removes them from defaults.\n\nStored in .arb/config.json as a JSON array under the 'defaults' key.",
    )
    .action(
      arbAction(async (ctx, nameArgs: string[], options) => {
        const configFile = join(ctx.arbRootDir, ".arb", "config.json");
        const allRepos = listRepos(ctx.reposDir);

        // List mode
        if (nameArgs.length === 0 && !options.remove) {
          const defaults = readProjectConfig(configFile)?.defaults ?? [];
          if (defaults.length === 0) {
            info("No default repos configured. Add with: arb repo default <names...>");
            return;
          }
          for (const name of defaults) {
            process.stdout.write(`${name}\n`);
          }
          return;
        }

        if (nameArgs.length === 0) {
          const msg = "No repos specified.";
          error(msg);
          throw new ArbError(msg);
        }

        const currentDefaults = readProjectConfig(configFile)?.defaults ?? [];

        if (options.remove) {
          for (const name of nameArgs) {
            if (!currentDefaults.includes(name)) {
              const msg = `Repo '${name}' is not a default.`;
              error(msg);
              throw new ArbError(msg);
            }
          }
          const updated = currentDefaults.filter((d) => !nameArgs.includes(d));
          writeProjectConfig(configFile, { defaults: updated.length > 0 ? updated : undefined });
          success(`Removed ${plural(nameArgs.length, "repo")} from defaults`);
        } else {
          // Validate repo names exist (only for add — remove tolerates stale entries)
          for (const name of nameArgs) {
            if (!allRepos.includes(name)) {
              const msg = `Repo '${name}' is not cloned.`;
              error(msg);
              throw new ArbError(msg);
            }
          }
          const toAdd = nameArgs.filter((n) => !currentDefaults.includes(n));
          const alreadyDefault = nameArgs.length - toAdd.length;
          const updated = [...currentDefaults, ...toAdd];
          writeProjectConfig(configFile, { defaults: updated });
          if (alreadyDefault > 0) {
            success(
              `Added ${plural(toAdd.length, "repo")} to defaults (${plural(alreadyDefault, "repo")} already ${alreadyDefault === 1 ? "was" : "were"} default)`,
            );
          } else {
            success(`Added ${plural(toAdd.length, "repo")} to defaults`);
          }
        }
      }),
    );
}
