import { existsSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { type Command, Option } from "commander";
import {
  ArbError,
  type OperationRecord,
  type RepoOperationState,
  arbAction,
  assertNoInProgressOperation,
  readInProgressOperation,
  readWorkspaceConfig,
  withReflogAction,
  writeOperationRecord,
  writeWorkspaceConfig,
} from "../lib/core";
import { branchExistsLocally, getCommitsBetweenFull, gitLocal } from "../lib/git";
import { finishSummary, render, verboseCommitsToNodes } from "../lib/render";
import type { RenderContext } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { cell, skipCell } from "../lib/render";
import { buildConflictReport } from "../lib/render/conflict-report";
import { EXTRACT_EXEMPT_SKIPS } from "../lib/status";
import {
  VERBOSE_COMMIT_LIMIT,
  buildCachedStatusAssess,
  confirmOrExit,
  parallelFetch,
  reportFetchFailures,
  resolveDefaultFetch,
  runPlanFlow,
  selectExtractBoundaries,
} from "../lib/sync";
import { assessExtractRepo } from "../lib/sync/classify-extract";
import { runContinueFlow } from "../lib/sync/continue-flow";
import { parseSplitPoints, resolveSplitPoints } from "../lib/sync/parse-split-points";
import type { ExtractAssessment } from "../lib/sync/types";
import { dryRunNotice, error, inlineResult, inlineStart, isTTY, plural, yellow } from "../lib/terminal";
import { shouldColor } from "../lib/terminal/tty";
import { addWorktrees, requireBranch, requireWorkspace, workspaceRepoDirs } from "../lib/workspace";
import { validateWorkspaceName } from "../lib/workspace/validation";

export function registerExtractCommand(program: Command): void {
  program
    .command("extract <workspace>")
    .addOption(
      new Option("--ending-with <specs...>", "Extract prefix (base through boundary) into new workspace").conflicts(
        "startingWith",
      ),
    )
    .addOption(
      new Option("--starting-with <specs...>", "Extract suffix (boundary through tip) into new workspace").conflicts(
        "endingWith",
      ),
    )
    .option("-b, --branch <name>", "Branch name for new workspace (defaults to workspace name)")
    .option("--fetch", "Fetch from all remotes before extract (default)")
    .option("-N, --no-fetch", "Skip fetching before extract")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show per-commit details in the plan")
    .option("--autostash", "Stash uncommitted changes before operation")
    .option("--include-wrong-branch", "Include repos on a different branch than the workspace")
    .addOption(new Option("--continue", "Resume after resolving conflicts").conflicts("abort"))
    .addOption(
      new Option("--abort", "Cancel the in-progress extract and restore pre-extract state").conflicts("continue"),
    )
    .summary("Extract commits into a new workspace")
    .description(
      "Examples:\n\n  arb extract prereq                                Interactive split-point selection\n  arb extract prereq --ending-with abc123          Extract prefix into 'prereq'\n  arb extract cont --starting-with abc123           Extract suffix into 'cont'\n  arb extract prereq --ending-with abc123,def456    Multiple repos (auto-detect)\n  arb extract prereq --ending-with api:HEAD~3       Per-repo with explicit prefix\n\nSplits the current workspace's branch at a boundary commit, creating a new stacked workspace.\n\nWith no flags, launches an interactive selector to choose the extraction direction and per-repo split points.\n\nWith --ending-with, extracts the prefix (base through boundary, inclusive) into a new lower workspace. The original workspace is rebased to stack on top.\n\nWith --starting-with, extracts the suffix (boundary through tip, inclusive) into a new upper workspace. The original workspace is reset to before the boundary.\n\nSplit points are specified as commit SHAs (auto-detect repo), <repo>:<commit-ish> (explicit), or tags. Multiple values can be comma-separated.\n\nRepos without an explicit split point have zero commits extracted — they are included in both workspaces but just track the base.\n\nIn base-merged workspaces, split points must be at or after the merge point — pre-merge commits are already on the default branch.",
    )
    .action(
      arbAction(async (ctx, workspaceName: string, options) => {
        const { wsDir, workspace } = requireWorkspace(ctx);

        // ── Operation lifecycle: --continue, --abort, gate ──
        if ((options.continue || options.abort) && (options.endingWith || options.startingWith)) {
          const flag = options.continue ? "--continue" : "--abort";
          error(`${flag} does not accept --ending-with or --starting-with`);
          throw new ArbError(`${flag} does not accept --ending-with or --starting-with`);
        }

        const inProgress = readInProgressOperation(wsDir, "extract") as
          | (OperationRecord & { command: "extract" })
          | null;

        if ((options.continue || options.abort) && inProgress && workspaceName !== inProgress.targetWorkspace) {
          const flag = options.continue ? "--continue" : "--abort";
          error(
            `${flag}: workspace name '${workspaceName}' does not match the in-progress extract target '${inProgress.targetWorkspace}'`,
          );
          throw new ArbError(`${flag}: workspace name mismatch`);
        }

        if (options.abort) {
          if (!inProgress) {
            error("No extract in progress. Nothing to abort.");
            throw new ArbError("No extract in progress. Nothing to abort.");
          }
          // Clean up branches created in canonical repos, then delegate to sync undo
          await cleanupExtractBranches(ctx.reposDir, inProgress);
          const { runUndoFlow } = await import("../lib/sync/undo");
          await runUndoFlow({
            wsDir,
            arbRootDir: ctx.arbRootDir,
            reposDir: ctx.reposDir,
            options,
            verb: "abort",
          });
          return;
        }

        if (options.continue) {
          if (!inProgress) {
            error("No extract in progress. Nothing to continue.");
            throw new ArbError("No extract in progress. Nothing to continue.");
          }
          const configFile = `${wsDir}/.arbws/config.json`;
          const branch = await requireBranch(wsDir, workspace);
          await runContinueFlow({
            record: inProgress,
            wsDir,
            mode: "extract",
            gitContinueCmd: "rebase",
            options,
            onComplete: async () => {
              // Create the new workspace (wasn't created because rebase conflicted)
              const allRepos = workspaceRepoDirs(wsDir).map((d) => basename(d));
              const newWsDir = `${ctx.arbRootDir}/${inProgress.targetWorkspace}`;
              if (!existsSync(newWsDir)) {
                mkdirSync(`${newWsDir}/.arbws`, { recursive: true });
                const configBase = readWorkspaceConfig(configFile)?.base ?? null;
                if (inProgress.direction === "prefix") {
                  writeWorkspaceConfig(`${newWsDir}/.arbws/config.json`, {
                    branch: inProgress.targetBranch,
                    ...(configBase && { base: configBase }),
                  });
                } else {
                  writeWorkspaceConfig(`${newWsDir}/.arbws/config.json`, {
                    branch: inProgress.targetBranch,
                    base: branch,
                  });
                }
                const remotesForContinue = await ctx.cache.resolveRemotesMap(allRepos, ctx.reposDir);
                await addWorktrees(
                  inProgress.targetWorkspace,
                  inProgress.targetBranch,
                  allRepos,
                  ctx.reposDir,
                  ctx.arbRootDir,
                  undefined,
                  remotesForContinue,
                  ctx.cache,
                );
              }
              // Apply deferred config
              if (inProgress.configAfter) {
                writeWorkspaceConfig(configFile, inProgress.configAfter);
              }
              inlineResult(workspace, `extract completed — new workspace: ${inProgress.targetWorkspace}`);
            },
          });
          return;
        }

        await assertNoInProgressOperation(wsDir);

        // ── Validation ──

        const nameError = validateWorkspaceName(workspaceName);
        if (nameError) {
          error(nameError);
          throw new ArbError(nameError);
        }

        const targetWsDir = `${ctx.arbRootDir}/${workspaceName}`;
        if (existsSync(targetWsDir)) {
          const msg = `Workspace '${workspaceName}' already exists`;
          error(msg);
          throw new ArbError(msg);
        }

        const targetBranch = options.branch ?? workspaceName;

        // ── Current workspace context ──

        const branch = await requireBranch(wsDir, workspace);
        const configFile = `${wsDir}/.arbws/config.json`;
        const configBase = readWorkspaceConfig(configFile)?.base ?? null;

        if (targetBranch === branch) {
          const msg = `Cannot extract to branch '${targetBranch}' — that is the current workspace branch`;
          error(msg);
          throw new ArbError(msg);
        }

        const cache = ctx.cache;
        const allFetchDirs = workspaceRepoDirs(wsDir);
        const allRepos = allFetchDirs.map((d) => basename(d));
        const remotesMap = await cache.resolveRemotesMap(allRepos, ctx.reposDir);

        // Validate target branch doesn't already exist
        for (const repo of allRepos) {
          const repoPath = `${ctx.reposDir}/${repo}`;
          if (await branchExistsLocally(repoPath, targetBranch)) {
            const msg = `Branch '${targetBranch}' already exists in repo '${repo}'`;
            error(msg);
            throw new ArbError(msg);
          }
        }

        // ── Mode dispatch: interactive vs explicit ──

        const isInteractive = !options.endingWith && !options.startingWith;
        const shouldFetch = resolveDefaultFetch(options.fetch);

        let direction: "prefix" | "suffix";
        let resolvedSplitPoints: Map<string, { repo: string; commitSha: string }>;
        let earlyFetchFailed: string[] = [];
        const mergeBaseMap = new Map<string, string>();

        const computeMergeBases = async () => {
          for (const repo of allRepos) {
            const repoDir = `${wsDir}/${repo}`;
            try {
              const baseRef = configBase
                ? `origin/${configBase}`
                : `origin/${(await cache.getDefaultBranch(`${ctx.reposDir}/${repo}`, "origin")) ?? "main"}`;
              const { stdout } = await gitLocal(repoDir, "merge-base", "HEAD", baseRef);
              mergeBaseMap.set(repo, stdout.trim());
            } catch {
              // No merge-base available — skip (repo may have no base)
            }
          }
        };

        if (isInteractive) {
          // Interactive mode: TTY required
          if (!isTTY() || !process.stdin.isTTY) {
            const msg = "Specify --ending-with (prefix extraction) or --starting-with (suffix extraction)";
            error(msg);
            throw new ArbError(msg);
          }

          // Fetch first so the selector has accurate commit data
          let interactiveFetchFailed: string[] = [];
          if (shouldFetch) {
            const fetchResults = await parallelFetch(allFetchDirs, undefined, remotesMap);
            interactiveFetchFailed = reportFetchFailures(allRepos, fetchResults);
            cache.invalidateAfterFetch();
          }

          await computeMergeBases();

          const result = await selectExtractBoundaries({
            allRepos,
            wsDir,
            mergeBaseMap,
            newWorkspace: workspaceName,
          });
          direction = result.direction;
          resolvedSplitPoints = result.resolvedSplitPoints;
          earlyFetchFailed = interactiveFetchFailed;
        } else {
          // Explicit mode (flags provided)
          direction = options.endingWith ? "prefix" : "suffix";

          const rawSpecs = options.endingWith ?? options.startingWith ?? [];
          const specs = parseSplitPoints(Array.isArray(rawSpecs) ? rawSpecs : [rawSpecs]);

          await computeMergeBases();

          resolvedSplitPoints =
            specs.length > 0
              ? await resolveSplitPoints(specs, allRepos, wsDir, mergeBaseMap)
              : new Map<string, { repo: string; commitSha: string }>();
        }

        // ── Assessment ──

        const assessmentShouldFetch = isInteractive ? false : shouldFetch;
        const autostash = options.autostash === true;
        const includeWrongBranch = options.includeWrongBranch === true;

        const assess = buildCachedStatusAssess<ExtractAssessment>({
          repos: allRepos,
          wsDir,
          reposDir: ctx.reposDir,
          branch,
          configBase,
          remotesMap,
          cache,
          analysisCache: ctx.analysisCache,
          classify: async ({ repo, repoDir, status, fetchFailed }) => {
            // Merge fetch failures from early interactive fetch with any from the plan flow
            const allFetchFailed =
              earlyFetchFailed.length > 0 ? [...new Set([...fetchFailed, ...earlyFetchFailed])] : fetchFailed;

            const boundary = resolvedSplitPoints.get(repo)?.commitSha ?? null;

            // Merge-point floor: in merged repos, reject split points below the merge point
            if (boundary && status.base?.merge?.newCommitsAfter) {
              const n = status.base.merge.newCommitsAfter;
              try {
                // HEAD~(n-1) is the first post-merge commit (the inclusive floor)
                const { stdout: floorStr } = await gitLocal(repoDir, "rev-parse", `HEAD~${n - 1}`);
                const floor = floorStr.trim();
                const { exitCode } = await gitLocal(repoDir, "merge-base", "--is-ancestor", floor, boundary);
                if (exitCode !== 0) {
                  return {
                    repo,
                    repoDir,
                    branch,
                    direction,
                    targetBranch,
                    boundary,
                    mergeBase: mergeBaseMap.get(repo) ?? "",
                    commitsExtracted: 0,
                    commitsRemaining: 0,
                    headSha: status.headSha ?? "",
                    shallow: status.identity.shallow,
                    baseRemote: status.base?.remote ?? "",
                    baseResolvedLocally: status.base?.resolvedVia === "local",
                    outcome: "skip" as const,
                    skipReason: "split point is before the merge point — only post-merge commits can be extracted",
                    skipFlag: "below-merge-point" as const,
                  };
                }
              } catch {
                // Cannot resolve merge point — fall through to normal assessment
              }
            }

            const mb = mergeBaseMap.get(repo) ?? "";
            return assessExtractRepo(status, repoDir, branch, direction, targetBranch, boundary, mb, allFetchFailed, {
              autostash,
              includeWrongBranch,
            });
          },
        });

        // Per-repo plan annotations (boundary endpoints for the "other" side)
        const planEndpoints = new Map<string, { extractEnd: string; remainEnd: string }>();

        const postAssess = async (nextAssessments: ExtractAssessment[]) => {
          // Compute commit counts and boundary endpoints for will-extract repos
          for (const a of nextAssessments) {
            if (a.outcome !== "will-extract" || !a.boundary) continue;
            try {
              const shortBoundary = a.boundary.slice(0, 7);
              if (direction === "prefix") {
                // Extracted = merge-base to boundary (inclusive)
                const { stdout: extractedStr } = await gitLocal(
                  a.repoDir,
                  "rev-list",
                  "--count",
                  `${a.mergeBase}..${a.boundary}`,
                );
                a.commitsExtracted = Number.parseInt(extractedStr.trim(), 10);
                // Remaining = boundary to HEAD (exclusive of boundary)
                const { stdout: remainingStr } = await gitLocal(
                  a.repoDir,
                  "rev-list",
                  "--count",
                  `${a.boundary}..HEAD`,
                );
                a.commitsRemaining = Number.parseInt(remainingStr.trim(), 10);
                // Endpoints: extracted ends at boundary, remaining starts at boundary's child
                let remainStart = "";
                if (a.commitsRemaining > 0) {
                  const { stdout: childStr } = await gitLocal(
                    a.repoDir,
                    "rev-list",
                    "--reverse",
                    "--ancestry-path",
                    `${a.boundary}..HEAD`,
                  );
                  const firstChild = childStr.trim().split("\n")[0];
                  if (firstChild) remainStart = firstChild.slice(0, 7);
                }
                planEndpoints.set(a.repo, { extractEnd: shortBoundary, remainEnd: remainStart });
              } else {
                // Extracted = boundary to HEAD (inclusive of boundary)
                const { stdout: afterStr } = await gitLocal(a.repoDir, "rev-list", "--count", `${a.boundary}..HEAD`);
                const afterCount = Number.parseInt(afterStr.trim(), 10);
                a.commitsExtracted = afterCount + 1; // +1 for the boundary commit itself
                // Remaining = merge-base to boundary (exclusive of boundary)
                const { stdout: beforeStr } = await gitLocal(
                  a.repoDir,
                  "rev-list",
                  "--count",
                  `${a.mergeBase}..${a.boundary}^`,
                );
                a.commitsRemaining = Number.parseInt(beforeStr.trim(), 10);
                // Endpoints: remaining ends at boundary's parent, extracted starts at boundary
                let remainEnd = "";
                if (a.commitsRemaining > 0) {
                  const { stdout: parentStr } = await gitLocal(a.repoDir, "rev-parse", `${a.boundary}^`);
                  remainEnd = parentStr.trim().slice(0, 7);
                }
                planEndpoints.set(a.repo, { extractEnd: shortBoundary, remainEnd });
              }
            } catch {
              // If counting fails, leave as 0
            }
          }
          if (options.verbose) {
            await gatherExtractVerboseCommits(nextAssessments, direction);
          }
          return nextAssessments;
        };

        const assessments = await runPlanFlow({
          shouldFetch: assessmentShouldFetch,
          fetchDirs: allFetchDirs,
          reposForFetchReport: allRepos,
          remotesMap,
          assess,
          postAssess,
          formatPlan: (nextAssessments) =>
            formatExtractPlan(
              nextAssessments,
              workspace,
              workspaceName,
              targetBranch,
              direction,
              configBase,
              planEndpoints,
              options.verbose,
            ),
          onPostFetch: () => cache.invalidateAfterFetch(),
        });

        // ── All-or-nothing check ──

        const willExtract = assessments.filter((a) => a.outcome === "will-extract");
        const skipped = assessments.filter((a) => a.outcome === "skip");

        if (willExtract.length === 0) {
          if (skipped.length > 0) {
            error("Cannot extract: all repos are blocked or have no commits to extract.");
          } else {
            error("Nothing to extract — no repos have commits at the specified split points.");
          }
          throw new ArbError("Nothing to extract");
        }

        // Block if any non-exempt repo is blocked
        const blockedRepos = assessments.filter(
          (a) => a.outcome === "skip" && (a.skipFlag == null || !EXTRACT_EXEMPT_SKIPS.has(a.skipFlag)),
        );
        if (blockedRepos.length > 0) {
          error("Cannot extract: some repos are blocked. Fix these issues and retry:");
          for (const a of blockedRepos) {
            process.stderr.write(`  ${a.repo} — ${a.skipReason}\n`);
          }
          throw new ArbError("Blocked repos prevent extract");
        }

        // ── Dry run / confirmation ──

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        await confirmOrExit({
          yes: options.yes,
          message: `Extract ${plural(willExtract.length, "repo", "repos")}?`,
        });

        // ── Execution ──

        process.stderr.write("\n");

        // Capture state and write operation record
        const configBefore = readWorkspaceConfig(configFile) ?? { branch };
        // Prefix: original workspace's base changes to the new branch
        // Suffix: original workspace's config is unchanged
        const configAfter = direction === "prefix" ? { branch, base: targetBranch } : configBefore;

        const repoStates: Record<string, RepoOperationState> = {};
        const noOps = assessments.filter((a) => a.outcome === "no-op");
        for (const a of [...willExtract, ...noOps]) {
          const headResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
          const preHead = headResult.stdout.trim();
          if (!preHead) throw new ArbError(`Cannot capture HEAD for ${a.repo}`);
          if (direction === "suffix" && a.outcome === "will-extract") {
            // Suffix modifies the original branch (reset) — capture stash
            const stashResult = await gitLocal(a.repoDir, "stash", "create");
            repoStates[a.repo] = { preHead, stashSha: stashResult.stdout.trim() || null, status: "skipped" };
          } else {
            // Prefix doesn't modify the branch — no stash needed
            repoStates[a.repo] = { preHead, status: "skipped" };
          }
        }

        const record: OperationRecord = {
          command: "extract",
          startedAt: new Date().toISOString(),
          status: "in-progress",
          repos: repoStates,
          direction,
          targetWorkspace: workspaceName,
          targetBranch,
          configBefore,
          configAfter,
        };
        writeOperationRecord(wsDir, record);

        // Execute git operations
        let succeeded = 0;
        const conflicted: { assessment: ExtractAssessment; stdout: string; stderr: string }[] = [];

        await withReflogAction("arb-extract", async () => {
          // Step 1: Create branches in canonical repos
          const createdBranches: string[] = [];
          for (const a of [...willExtract, ...noOps]) {
            const repoPath = `${ctx.reposDir}/${a.repo}`;
            let startPoint: string;
            if (a.outcome === "will-extract" && a.boundary) {
              if (direction === "prefix") {
                // Prefix: new branch at the boundary (lower workspace gets commits up to boundary)
                startPoint = a.boundary;
              } else {
                // Suffix: new branch at worktree HEAD (upper workspace gets commits from boundary onward)
                startPoint = a.headSha;
              }
            } else {
              // No-op repo: use merge-base for prefix, worktree HEAD for suffix
              if (direction === "prefix") {
                startPoint = mergeBaseMap.get(a.repo) ?? a.headSha;
              } else {
                startPoint = a.headSha;
              }
            }
            const result = await gitLocal(repoPath, "branch", targetBranch, startPoint);
            if (result.exitCode !== 0) {
              for (const created of createdBranches) {
                await gitLocal(`${ctx.reposDir}/${created}`, "branch", "-D", targetBranch).catch(() => {});
              }
              throw new ArbError(
                `Failed to create branch '${targetBranch}' in repo '${a.repo}': ${result.stderr.trim()}`,
              );
            }
            inlineResult(a.repo, `branch '${targetBranch}' created at ${startPoint.slice(0, 7)}`);
            createdBranches.push(a.repo);
          }

          // Step 2: Move commits (suffix only — prefix needs no rebase)
          if (direction === "suffix") {
            for (const a of willExtract) {
              if (!a.boundary) continue;
              const n = a.commitsExtracted;
              inlineStart(a.repo, `moving ${plural(n, "commit", "commits")} to ${targetBranch}`);

              const resetTarget = `${a.boundary}~1`;
              const result = await gitLocal(a.repoDir, "reset", "--hard", resetTarget);

              if (result.exitCode === 0) {
                const postHeadResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
                const existing = record.repos[a.repo];
                if (existing) {
                  record.repos[a.repo] = { ...existing, status: "completed", postHead: postHeadResult.stdout.trim() };
                }
                writeOperationRecord(wsDir, record);
                inlineResult(a.repo, `${plural(n, "commit", "commits")} moved to ${targetBranch}`);
                succeeded++;
              } else {
                const existing = record.repos[a.repo];
                if (existing) {
                  const errorOutput = result.stderr.trim().slice(0, 4000) || undefined;
                  record.repos[a.repo] = { ...existing, status: "conflicting", errorOutput };
                }
                writeOperationRecord(wsDir, record);
                inlineResult(a.repo, yellow("failed"));
                conflicted.push({ assessment: a, stdout: result.stdout, stderr: result.stderr });
              }
            }
          } else {
            // Prefix: no rebase needed — commits are already children of the boundary.
            // The new branch was created at the boundary; the remaining commits sit on top.
            for (const a of willExtract) {
              const existing = record.repos[a.repo];
              if (existing) {
                record.repos[a.repo] = { ...existing, status: "completed", postHead: a.headSha };
              }
              succeeded++;
            }
            writeOperationRecord(wsDir, record);
          }
        });

        // Conflict report (suffix only — prefix can't conflict)
        if (conflicted.length > 0) {
          const conflictNodes = buildConflictReport(
            conflicted.map((c) => ({
              repo: c.assessment.repo,
              stdout: c.stdout,
              stderr: c.stderr,
              mode: "extract",
            })),
          );
          const reportCtx = { tty: shouldColor() };
          if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));
        }

        // Step 3: Create new workspace
        if (conflicted.length === 0) {
          const newWsDir = `${ctx.arbRootDir}/${workspaceName}`;
          mkdirSync(`${newWsDir}/.arbws`, { recursive: true });

          if (direction === "prefix") {
            // New workspace (lower) gets the original's base
            writeWorkspaceConfig(`${newWsDir}/.arbws/config.json`, {
              branch: targetBranch,
              ...(configBase && { base: configBase }),
            });
          } else {
            // New workspace (upper) stacks on the original's branch
            writeWorkspaceConfig(`${newWsDir}/.arbws/config.json`, {
              branch: targetBranch,
              base: branch,
            });
          }

          // Create worktrees (branches already exist from step 1)
          await addWorktrees(
            workspaceName,
            targetBranch,
            allRepos,
            ctx.reposDir,
            ctx.arbRootDir,
            undefined,
            remotesMap,
            cache,
          );

          // Update original workspace config (prefix only — suffix leaves it unchanged)
          if (direction === "prefix") {
            writeWorkspaceConfig(configFile, configAfter);
            inlineResult(workspace, `base: ${configBase ?? "default"} → ${targetBranch}`);
          }

          // Mark operation complete
          record.status = "completed";
          record.completedAt = new Date().toISOString();
          writeOperationRecord(wsDir, record);
        }

        // Summary
        process.stderr.write("\n");
        if (conflicted.length > 0) {
          finishSummary([`${conflicted.length} conflicted`], true);
        } else {
          const detail =
            noOps.length > 0
              ? `(extracted from ${plural(succeeded, "repo")}, ${noOps.length} unchanged)`
              : `(extracted from ${plural(succeeded, "repo")})`;
          finishSummary([`Created workspace '${workspaceName}' ${detail}`], false);
        }
      }),
    );
}

// ── Plan formatting ──

/** @internal Exported for testing. */
export function formatExtractPlan(
  assessments: ExtractAssessment[],
  workspace: string,
  targetWorkspace: string,
  targetBranch: string,
  direction: "prefix" | "suffix",
  configBase: string | null,
  endpoints?: Map<string, { extractEnd: string; remainEnd: string }>,
  verbose?: boolean,
): string {
  const nodes = buildExtractPlanNodes(
    assessments,
    workspace,
    targetWorkspace,
    targetBranch,
    direction,
    configBase,
    endpoints,
    verbose,
  );
  const envCols = Number(process.env.COLUMNS);
  const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
  const ctx: RenderContext = { tty: shouldColor(), terminalWidth: termCols > 0 ? termCols : undefined };
  return render(nodes, ctx);
}

function buildExtractPlanNodes(
  assessments: ExtractAssessment[],
  workspace: string,
  targetWorkspace: string,
  targetBranch: string,
  direction: "prefix" | "suffix",
  configBase: string | null,
  endpoints?: Map<string, { extractEnd: string; remainEnd: string }>,
  verbose?: boolean,
): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  // Header
  const dirLabel = direction === "prefix" ? "prefix" : "suffix";
  nodes.push({
    kind: "message",
    level: "default",
    text: `Extract ${dirLabel} from ${workspace} into ${targetWorkspace}:`,
  });
  nodes.push({ kind: "gap" });

  // Column names depend on direction
  const newLabel = `EXTRACTED (${targetWorkspace})`;
  const origLabel = `STAYS (${workspace})`;

  const rows = assessments.map((a) => {
    let newCell: Cell;
    let origCell: Cell;

    if (a.outcome === "will-extract") {
      const stashNote = a.needsStash ? " (autostash)" : "";
      const ep = endpoints?.get(a.repo);
      const allExtracted = a.commitsRemaining === 0;
      const allRemaining = a.commitsExtracted === 0;
      let extractedText: string;
      let remainingText: string;
      if (direction === "prefix") {
        const endNote = ep?.extractEnd ? `, ending with ${ep.extractEnd}` : "";
        const startNote = ep?.remainEnd ? `, starting with ${ep.remainEnd}` : "";
        extractedText =
          a.commitsExtracted > 0
            ? `${allExtracted ? "all " : ""}${plural(a.commitsExtracted, "commit", "commits")}${endNote}`
            : "no commits";
        remainingText =
          a.commitsRemaining > 0
            ? `${allRemaining ? "all " : ""}${plural(a.commitsRemaining, "commit", "commits")}${startNote}${stashNote}`
            : `no commits${stashNote}`;
      } else {
        const startNote = ep?.extractEnd ? `, starting with ${ep.extractEnd}` : "";
        const endNote = ep?.remainEnd ? `, ending with ${ep.remainEnd}` : "";
        extractedText =
          a.commitsExtracted > 0
            ? `${allExtracted ? "all " : ""}${plural(a.commitsExtracted, "commit", "commits")}${startNote}${stashNote}`
            : "no commits";
        remainingText =
          a.commitsRemaining > 0
            ? `${allRemaining ? "all " : ""}${plural(a.commitsRemaining, "commit", "commits")}${endNote}`
            : "no commits";
      }
      newCell = cell(extractedText);
      origCell = cell(remainingText);
    } else if (a.outcome === "no-op") {
      const allPrefix = a.commitsRemaining > 0 ? "all " : "";
      const remainingText =
        a.commitsRemaining > 0 ? `${allPrefix}${plural(a.commitsRemaining, "commit", "commits")}` : "no commits";
      newCell = cell("no commits", "muted");
      origCell = cell(remainingText, "muted");
    } else {
      // skip
      newCell = skipCell(a.skipReason, a.skipFlag);
      origCell = cell("");
    }

    let afterRow: OutputNode[] | undefined;
    if (verbose && a.outcome === "will-extract" && a.verbose) {
      const verboseNodes: OutputNode[] = [];
      const extractedLabel = `Extracted to ${targetWorkspace}:`;
      const staysLabel = `Stays in ${workspace}:`;

      const extractedSection =
        a.verbose.extractedCommits && a.verbose.extractedCommits.length > 0
          ? verboseCommitsToNodes(
              a.verbose.extractedCommits,
              a.verbose.totalExtracted ?? a.verbose.extractedCommits.length,
              extractedLabel,
            )
          : [];
      const staysSection =
        a.verbose.remainingCommits && a.verbose.remainingCommits.length > 0
          ? verboseCommitsToNodes(
              a.verbose.remainingCommits,
              a.verbose.totalRemaining ?? a.verbose.remainingCommits.length,
              staysLabel,
            )
          : [];

      if (direction === "prefix") {
        verboseNodes.push(...extractedSection, ...staysSection);
      } else {
        verboseNodes.push(...staysSection, ...extractedSection);
      }
      if (verboseNodes.length > 0) afterRow = verboseNodes;
    }

    if (direction === "prefix") {
      return { cells: { repo: cell(a.repo), new: newCell, orig: origCell }, afterRow };
    }
    return { cells: { repo: cell(a.repo), orig: origCell, new: newCell }, afterRow };
  });

  const columns =
    direction === "prefix"
      ? [
          { header: "REPO", key: "repo" },
          { header: newLabel, key: "new" },
          { header: origLabel, key: "orig" },
        ]
      : [
          { header: "REPO", key: "repo" },
          { header: origLabel, key: "orig" },
          { header: newLabel, key: "new" },
        ];

  nodes.push({ kind: "table", columns, rows });

  // Summary hints
  nodes.push({ kind: "gap" });

  if (direction === "prefix") {
    const baseName = configBase ?? "default";
    nodes.push({
      kind: "hint",
      cell: cell(`  New workspace: ${targetWorkspace} (branch: ${targetBranch}, base: ${baseName})`),
    });
    nodes.push({
      kind: "hint",
      cell: cell(`  ${workspace} base: ${baseName} → ${targetBranch}`),
    });
  } else {
    nodes.push({
      kind: "hint",
      cell: cell(`  New workspace: ${targetWorkspace} (branch: ${targetBranch}, base: ${workspace})`),
    });
  }

  nodes.push({ kind: "gap" });
  return nodes;
}

// ── Helpers ──

/** Gather per-commit details for the extract plan's verbose mode. */
async function gatherExtractVerboseCommits(
  assessments: ExtractAssessment[],
  direction: "prefix" | "suffix",
): Promise<void> {
  await Promise.all(
    assessments
      .filter((a): a is ExtractAssessment & { boundary: string } => a.outcome === "will-extract" && a.boundary != null)
      .map(async (a) => {
        try {
          const boundary = a.boundary;
          let extracted: { shortHash: string; fullHash: string; subject: string }[];
          let remaining: { shortHash: string; fullHash: string; subject: string }[];
          if (direction === "prefix") {
            extracted = await getCommitsBetweenFull(a.repoDir, a.mergeBase, boundary);
            remaining = await getCommitsBetweenFull(a.repoDir, boundary, "HEAD");
          } else {
            remaining = await getCommitsBetweenFull(a.repoDir, a.mergeBase, `${boundary}^`);
            extracted = await getCommitsBetweenFull(a.repoDir, `${boundary}^`, "HEAD");
          }
          a.verbose = {
            extractedCommits: extracted.slice(0, VERBOSE_COMMIT_LIMIT),
            totalExtracted: extracted.length,
            remainingCommits: remaining.slice(0, VERBOSE_COMMIT_LIMIT),
            totalRemaining: remaining.length,
          };
        } catch {
          // If commit gathering fails, leave verbose empty
        }
      }),
  );
}

/** Delete branches created in canonical repos during extract (for abort/undo). */
async function cleanupExtractBranches(
  reposDir: string,
  record: OperationRecord & { command: "extract" },
): Promise<void> {
  for (const repoName of Object.keys(record.repos)) {
    const repoPath = `${reposDir}/${repoName}`;
    if (await branchExistsLocally(repoPath, record.targetBranch)) {
      await gitLocal(repoPath, "branch", "-D", record.targetBranch).catch(() => {});
    }
  }
}
