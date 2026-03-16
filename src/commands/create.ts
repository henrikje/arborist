import { existsSync, mkdirSync } from "node:fs";
import input from "@inquirer/input";
import select, { Separator } from "@inquirer/select";
import type { Command } from "commander";
import { ArbError, arbAction, readWorkspaceConfig, writeWorkspaceConfig } from "../lib/core";
import type { RepoRemotes } from "../lib/git";
import { git, listRemoteBranches, validateBranchName } from "../lib/git";
import { render } from "../lib/render";
import {
  loadFetchTimestamps,
  parallelFetch,
  recordFetchResults,
  reportFetchFailures,
  saveFetchTimestamps,
} from "../lib/sync";
import { applyRepoTemplates, applyWorkspaceTemplates, displayOverlaySummary } from "../lib/templates";
import { bold, cyan, dim, error, info, isTTY, plural, readNamesFromStdin, success, warn } from "../lib/terminal";
import {
  addWorktrees,
  listDefaultRepos,
  listRepos,
  listWorkspaces,
  rollbackWorktrees,
  selectReposInteractive,
  validateWorkspaceName,
} from "../lib/workspace";

const CREATE_DEFAULT = "\0create-default";
const CREATE_CUSTOM = "\0create-custom";
const BASE_DEFAULT = "\0base-default";
const BASE_CUSTOM = "\0base-custom";

export function deriveWorkspaceNameFromBranch(branch: string): string | null {
  const tail = branch.split("/").filter(Boolean).at(-1);
  return tail ?? null;
}

export function shouldShowBranchPasteHint(
  nameArg: string | undefined,
  branchOpt: string | undefined,
  validationError: string,
): boolean {
  if (!nameArg || branchOpt) return false;
  if (!validationError.includes("must not contain '/'")) return false;
  return validateBranchName(nameArg);
}

export function registerCreateCommand(program: Command): void {
  program
    .command("create [name] [repos...]")
    .option("-b, --branch <branch>", "Branch name")
    .option("--base <branch>", "Base branch to branch from")
    .option("-a, --all-repos", "Include all repos")
    .option("-y, --yes", "Skip interactive prompts and use configured defaults")
    .option("--fetch", "Fetch before creating (default)")
    .option("-N, --no-fetch", "Skip pre-fetch")
    .summary("Create a new workspace")
    .description(
      "Create a workspace for a feature or issue. Creates a working copy of each selected repo on a shared feature branch, with isolated working directories. Fetches the selected repos before creating worktrees for fresh remote state (skip with -N/--no-fetch). Automatically seeds files from .arb/templates/ into the new workspace. Running with no arguments opens a guided flow; providing args or flags uses sensible defaults and prompts only for missing required values.\n\nIf the branch already exists locally or on the share remote, arb checks it out instead of creating a new one. This lets you resume work on an existing feature, collaborate on a shared branch, or set up a local workspace for a branch someone else started.\n\nIf any repo fails to attach (for example, the branch is already checked out in another workspace), the entire operation is aborted and any partially created worktrees are rolled back. Use 'arb attach' to add repos individually if partial success is acceptable.\n\nSee 'arb help stacked' for stacking workspaces on feature branches.",
    )
    .action(
      arbAction(async (ctx, nameArg: string | undefined, repoArgs: string[], options) => {
        const isInteractive = process.stdin.isTTY === true;
        const isBareGuidedCreate =
          isInteractive && !nameArg && repoArgs.length === 0 && !options.branch && !options.yes;
        const allKnownRepos = listRepos(ctx.reposDir);

        if (allKnownRepos.length === 0) {
          const msg = "No repos found. Clone a repo first: arb repo clone <url>";
          error(msg);
          throw new ArbError(msg);
        }

        // 1. Workspace name
        const isDerivedFromBranch = !nameArg && !!options.branch;
        const derivedName = options.branch ? deriveWorkspaceNameFromBranch(options.branch) : null;
        if (isDerivedFromBranch && !derivedName) {
          const msg = `Could not derive workspace name from branch '${options.branch}'. Pass an explicit workspace name: arb create <workspace-name> --branch ${options.branch}`;
          error(msg);
          throw new ArbError(msg);
        }

        let name = nameArg ?? derivedName ?? undefined;
        if (!name) {
          if (!process.stdin.isTTY || options.yes) {
            const msg = "Usage: arb create <name> [repos...]";
            error(msg);
            throw new ArbError(msg);
          }
          name = await input(
            {
              message: "Workspace:",
              validate: (v) => {
                const formatError = validateWorkspaceName(v);
                if (formatError) return formatError;
                if (existsSync(`${ctx.arbRootDir}/${v}`)) return `Workspace '${v}' already exists`;
                return true;
              },
            },
            { output: process.stderr },
          );
        }

        const validationError = validateWorkspaceName(name);
        if (validationError) {
          if (shouldShowBranchPasteHint(nameArg, options.branch, validationError)) {
            error(validationError);
            process.stderr.write("\n");
            info("It looks like you may have pasted a branch name.");
            process.stderr.write("\n");
            info("Try:");
            info(`  arb create --branch ${nameArg}`);
            process.stderr.write("\n");
            info("Or set an explicit workspace name:");
            info(`  arb create <workspace-name> --branch ${nameArg}`);
            throw new ArbError(validationError);
          }
          if (isDerivedFromBranch) {
            const msg = `Derived workspace name '${name}' from branch '${options.branch}' is invalid.`;
            error(msg);
            info(`Pass an explicit workspace name: arb create <workspace-name> --branch ${options.branch}`);
            throw new ArbError(msg);
          }
          error(validationError);
          throw new ArbError(validationError);
        }

        const wsDir = `${ctx.arbRootDir}/${name}`;
        if (existsSync(wsDir)) {
          if (isDerivedFromBranch) {
            const msg = `Derived workspace name '${name}' from branch '${options.branch}' already exists.`;
            error(msg);
            info(`Pass an explicit workspace name: arb create <workspace-name> --branch ${options.branch}`);
            throw new ArbError(msg);
          }
          const msg = `Workspace '${name}' already exists`;
          error(msg);
          throw new ArbError(msg);
        }
        const nameWasPrompted = !nameArg && !isDerivedFromBranch;
        if (!isBareGuidedCreate) {
          // Workspace (skip if just prompted interactively)
          if (!nameWasPrompted) {
            if (isDerivedFromBranch) {
              info(`${cyan("›")} ${bold("Workspace")}: ${cyan(name)} (derived from branch)`);
            } else {
              info(`${cyan("›")} ${bold("Workspace")}: ${cyan(name)}`);
            }
          }
          // Branch
          if (options.branch) {
            info(`${cyan("›")} ${bold("Branch")}: ${cyan(options.branch)}`);
          } else {
            info(`${cyan("›")} ${bold("Branch")}: ${cyan(name)} (same as workspace, use --branch to override)`);
          }
          // Base branch
          if (options.base) {
            info(`${cyan("›")} ${bold("Base")}: ${cyan(options.base)}`);
          } else {
            info(`${cyan("›")} ${bold("Base")}: ${cyan("repo default")} (use --base to override)`);
          }
          // Repos (only when known from args/flags, not pending interactive selection)
          if (options.allRepos) {
            info(`${cyan("›")} ${bold("Repos")}: ${cyan("all")}`);
          } else if (repoArgs.length > 0) {
            info(`${cyan("›")} ${bold("Repos")}: ${cyan(repoArgs.join(", "))}`);
          }
        }

        // 2. Repo selection (moved before branch)
        let repos = repoArgs;

        if (options.allRepos) {
          repos = allKnownRepos;
        }

        if (repos.length === 0) {
          const stdinNames = await readNamesFromStdin();
          if (stdinNames.length > 0) repos = stdinNames;
        }

        if (repos.length > 0 && !options.allRepos) {
          const unknown = repos.filter((r) => !allKnownRepos.includes(r));
          if (unknown.length > 0) {
            const msg = `Unknown repos: ${unknown.join(", ")}. Not found in .arb/repos/.`;
            error(msg);
            throw new ArbError(msg);
          }
        }

        const defaults = listDefaultRepos(ctx.arbRootDir);

        if (repos.length === 0 && (!process.stdin.isTTY || options.yes) && defaults.size > 0) {
          repos = [...defaults].filter((r) => allKnownRepos.includes(r));
        }

        if (repos.length === 0 && options.yes) {
          const msg = "No default repos configured. Set defaults with: arb repo default <repo>";
          error(msg);
          throw new ArbError(msg);
        }

        if (repos.length === 0 && process.stdin.isTTY) {
          try {
            repos = await selectReposInteractive(ctx.reposDir, defaults);
          } catch (e) {
            error((e as Error).message);
            throw new ArbError((e as Error).message);
          }
        }

        if (repos.length === 0) {
          const msg = "Usage: arb create <name> [repos...]";
          error(msg);
          throw new ArbError(msg);
        }

        // Hoist cache (needed for branch discovery and addWorktrees)
        const cache = ctx.cache;
        const fetchTimestamps = loadFetchTimestamps(ctx.arbRootDir);
        let remotesMap: Map<string, RepoRemotes> | undefined;
        let alreadyFetched = false;

        // 3. Branch selection
        const defaultBranch = name;
        let branch = options.branch;
        let discoveredBranches: string[] = [];
        if (!branch) {
          if (isBareGuidedCreate) {
            // Fetch selected repos so branch list is up-to-date
            remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
            if (options.fetch !== false) {
              const fetchDirs = repos.map((r) => `${ctx.reposDir}/${r}`);
              const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
              recordFetchResults(fetchTimestamps, fetchResults);
              saveFetchTimestamps(ctx.arbRootDir, fetchTimestamps);
              reportFetchFailures(repos, fetchResults);
              cache.invalidateAfterFetch();
            }
            alreadyFetched = true;

            // Discover remote branches from selected repos
            const branchSets = await Promise.all(
              repos.map(async (repo) => {
                const remotes = remotesMap?.get(repo);
                if (!remotes) return [];
                const repoDir = `${ctx.reposDir}/${repo}`;
                const branches = await listRemoteBranches(repoDir, remotes.share);
                const defaultBr = await cache.getDefaultBranch(repoDir, remotes.share);
                return branches.filter((b) => b !== defaultBr);
              }),
            );
            const allBranches = [...new Set(branchSets.flat())].sort();
            discoveredBranches = allBranches;

            if (allBranches.length > 0) {
              const defaultIsExisting = allBranches.includes(defaultBranch);
              const defaultLabel = defaultIsExisting
                ? `${defaultBranch} (existing branch)`
                : `${defaultBranch} (new branch)`;
              const remainingBranches = allBranches.filter((b) => b !== defaultBranch);

              const selected = await select(
                {
                  message: "Branch:",
                  choices: [
                    { name: defaultLabel, value: CREATE_DEFAULT },
                    { name: "Enter a different name...", value: CREATE_CUSTOM },
                    new Separator(),
                    ...remainingBranches.map((b) => ({ name: b, value: b })),
                  ],
                  pageSize: 20,
                  loop: false,
                },
                { output: process.stderr },
              );

              if (selected === CREATE_DEFAULT) {
                branch = defaultBranch;
              } else if (selected !== CREATE_CUSTOM) {
                branch = selected;
              }
              // CREATE_CUSTOM falls through to input below
            }
          }

          if (!branch) {
            if (isBareGuidedCreate) {
              branch = await input(
                {
                  message: "Branch:",
                  validate: (v) => (validateBranchName(v) ? true : "Invalid branch name"),
                },
                { output: process.stderr },
              );
            } else {
              branch = defaultBranch;
            }
          }
        }

        if (!validateBranchName(branch)) {
          const msg = `Invalid branch name: ${branch}`;
          error(msg);
          throw new ArbError(msg);
        }

        // 4. Base branch
        let base = options.base;
        if (!base && isBareGuidedCreate) {
          // Build workspace branch lookup for annotations
          const workspaceBranchMap = new Map<string, string>();
          for (const ws of listWorkspaces(ctx.arbRootDir)) {
            const wsBranch = readWorkspaceConfig(`${ctx.arbRootDir}/${ws}/.arbws/config.json`)?.branch;
            if (wsBranch) workspaceBranchMap.set(wsBranch, ws);
          }

          // Filter workspace branches to those that exist in selected repos (locally or remotely)
          const discoveredSet = new Set(discoveredBranches);
          const wsBranchesToCheck = [...workspaceBranchMap.keys()].filter((b) => !discoveredSet.has(b));
          const localChecks = await Promise.all(
            wsBranchesToCheck.map(async (wsBranch) => {
              for (const repo of repos) {
                const result = await git(
                  `${ctx.reposDir}/${repo}`,
                  "show-ref",
                  "--verify",
                  "--quiet",
                  `refs/heads/${wsBranch}`,
                );
                if (result.exitCode === 0) return true;
              }
              return false;
            }),
          );
          for (let i = 0; i < wsBranchesToCheck.length; i++) {
            const b = wsBranchesToCheck[i];
            if (b && !localChecks[i]) workspaceBranchMap.delete(b);
          }

          // Merge remote branches with workspace branches (which may not be pushed yet)
          const baseCandidates = [...new Set([...discoveredBranches, ...workspaceBranchMap.keys()])]
            .filter((b) => b !== branch)
            .sort();

          if (baseCandidates.length > 0) {
            // Sort: workspace branches first, then alphabetical
            const wsbranches = baseCandidates.filter((b) => workspaceBranchMap.has(b));
            const otherBranches = baseCandidates.filter((b) => !workspaceBranchMap.has(b));

            const wsChoices = wsbranches.map((b) => ({
              name: `${b} (workspace: ${workspaceBranchMap.get(b)})`,
              value: b,
            }));
            const otherChoices = otherBranches.map((b) => ({ name: b, value: b }));
            const branchChoices =
              wsChoices.length > 0 && otherChoices.length > 0
                ? [...wsChoices, new Separator(), ...otherChoices]
                : [...wsChoices, ...otherChoices];

            const selected = await select(
              {
                message: "Base:",
                choices: [
                  { name: "No explicit base branch (track repo default)", value: BASE_DEFAULT },
                  { name: "Enter a custom branch name...", value: BASE_CUSTOM },
                  new Separator(),
                  ...branchChoices,
                ],
                pageSize: 20,
                loop: false,
              },
              { output: process.stderr },
            );

            if (selected === BASE_CUSTOM) {
              base = await input(
                {
                  message: "Base:",
                  validate: (v) => (validateBranchName(v) ? true : "Invalid branch name"),
                },
                { output: process.stderr },
              );
            } else if (selected !== BASE_DEFAULT) {
              base = selected;
            }
          }
        }
        if (base && !validateBranchName(base)) {
          const msg = `Invalid base branch name: ${base}`;
          error(msg);
          throw new ArbError(msg);
        }

        // 5. Create workspace
        mkdirSync(`${wsDir}/.arbws`, { recursive: true });
        writeWorkspaceConfig(`${wsDir}/.arbws/config.json`, { branch, ...(base && { base }) });

        if (!remotesMap) {
          remotesMap = await cache.resolveRemotesMap(repos, ctx.reposDir);
        }

        // Fetch repos (skip if interactive branch selector already fetched, or --no-fetch)
        if (!alreadyFetched && options.fetch !== false) {
          const fetchDirs = repos.map((r) => `${ctx.reposDir}/${r}`);
          const fetchResults = await parallelFetch(fetchDirs, undefined, remotesMap);
          recordFetchResults(fetchTimestamps, fetchResults);
          saveFetchTimestamps(ctx.arbRootDir, fetchTimestamps);
          reportFetchFailures(repos, fetchResults);
        }

        const result = await addWorktrees(name, branch, repos, ctx.reposDir, ctx.arbRootDir, base, remotesMap, cache);

        if (result.failed.length > 0) {
          await rollbackWorktrees(result, branch, ctx.reposDir, wsDir);
          process.stderr.write("\n");
          const msg = `Failed to create workspace: could not attach ${plural(result.failed.length, "repo")} (${result.failed.join(", ")})`;
          error(
            `${msg}. The workspace was rolled back. This usually means the branch is already checked out elsewhere or the repo has conflicting state — check the errors above.`,
          );
          throw new ArbError(msg);
        }

        const wsTemplates = await applyWorkspaceTemplates(ctx.arbRootDir, wsDir, undefined, cache);
        const repoTemplates = await applyRepoTemplates(ctx.arbRootDir, wsDir, result.created, undefined, cache);
        displayOverlaySummary(wsTemplates, repoTemplates, (nodes) => render(nodes, { tty: isTTY() }));

        process.stderr.write("\n");
        const branchSuffix = branch === defaultBranch ? "" : ` on branch ${branch}`;
        if (result.skipped.length === 0) {
          success(`Created workspace ${name} (${plural(result.created.length, "repo")})${branchSuffix}`);
          info(`  ${dim(wsDir)}`);
        } else {
          success(`Created workspace ${name}${branchSuffix}`);
          if (result.created.length > 0) info(`  added:   ${result.created.join(" ")}`);
          if (result.skipped.length > 0) warn(`  skipped: ${result.skipped.join(" ")}`);
          info(`  ${dim(wsDir)}`);
        }

        process.stdout.write(`${wsDir}\n`);
      }),
    );
}
