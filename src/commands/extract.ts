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
import { branchExistsLocally, gitLocal } from "../lib/git";
import { finishSummary, render } from "../lib/render";
import type { RenderContext } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { cell, skipCell } from "../lib/render";
import { buildConflictReport } from "../lib/render/conflict-report";
import { EXTRACT_EXEMPT_SKIPS } from "../lib/status";
import { buildCachedStatusAssess, confirmOrExit, resolveDefaultFetch, runPlanFlow } from "../lib/sync";
import { assessExtractRepo } from "../lib/sync/classify-extract";
import { runContinueFlow } from "../lib/sync/continue-flow";
import { parseSplitPoints, resolveSplitPoints } from "../lib/sync/parse-split-points";
import type { ExtractAssessment } from "../lib/sync/types";
import { dryRunNotice, error, inlineResult, inlineStart, plural, yellow } from "../lib/terminal";
import { shouldColor } from "../lib/terminal/tty";
import { addWorktrees, requireBranch, requireWorkspace, workspaceRepoDirs } from "../lib/workspace";
import { validateWorkspaceName } from "../lib/workspace/validation";

export function registerExtractCommand(program: Command): void {
  program
    .command("extract <workspace>")
    .addOption(
      new Option("--ending-with <specs...>", "Extract prefix (base through boundary) into new workspace")
        .conflicts("startingWith")
        .conflicts("afterMerge"),
    )
    .addOption(
      new Option("--starting-with <specs...>", "Extract suffix (boundary through tip) into new workspace")
        .conflicts("endingWith")
        .conflicts("afterMerge"),
    )
    .addOption(
      new Option("--after-merge", "Extract suffix after merge point (auto-detect)")
        .conflicts("endingWith")
        .conflicts("startingWith"),
    )
    .option("-b, --branch <name>", "Branch name for new workspace (defaults to workspace name)")
    .option("--fetch", "Fetch from all remotes before extract (default)")
    .option("-N, --no-fetch", "Skip fetching before extract")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    // TODO: implement verbose plan with per-commit listing
    // .option("-v, --verbose", "Show per-commit details in the plan")
    .option("--autostash", "Stash uncommitted changes before operation")
    .option("--include-wrong-branch", "Include repos on a different branch than the workspace")
    .addOption(new Option("--continue", "Resume after resolving conflicts").conflicts("abort"))
    .addOption(
      new Option("--abort", "Cancel the in-progress extract and restore pre-extract state").conflicts("continue"),
    )
    .summary("Extract commits into a new workspace")
    .description(
      "Examples:\n\n  arb extract prereq --ending-with abc123         Extract prefix into 'prereq'\n  arb extract cont --starting-with abc123          Extract suffix into 'cont'\n  arb extract cont --after-merge                   Extract post-merge commits\n  arb extract prereq --ending-with abc123,def456   Multiple repos (auto-detect)\n  arb extract prereq --ending-with api:HEAD~3      Per-repo with explicit prefix\n\nSplits the current workspace's branch at a boundary commit, creating a new stacked workspace.\n\nWith --ending-with, extracts the prefix (base through boundary, inclusive) into a new lower workspace. The original workspace is rebased to stack on top.\n\nWith --starting-with, extracts the suffix (boundary through tip, inclusive) into a new upper workspace. The original workspace is reset to before the boundary.\n\nWith --after-merge, auto-detects the merge point and extracts post-merge commits into a new workspace.\n\nSplit points are specified as commit SHAs (auto-detect repo), <repo>:<commit-ish> (explicit), or tags. Multiple values can be comma-separated.\n\nRepos without an explicit split point have zero commits extracted — they are included in both workspaces but just track the base.",
    )
    .action(
      arbAction(async (ctx, workspaceName: string, options) => {
        const { wsDir, workspace } = requireWorkspace(ctx);

        // ── Operation lifecycle: --continue, --abort, gate ──
        if ((options.continue || options.abort) && (options.endingWith || options.startingWith || options.afterMerge)) {
          const flag = options.continue ? "--continue" : "--abort";
          error(`${flag} does not accept --ending-with, --starting-with, or --after-merge`);
          throw new ArbError(`${flag} does not accept --ending-with, --starting-with, or --after-merge`);
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

        // Direction from flags
        if (!options.endingWith && !options.startingWith && !options.afterMerge) {
          const msg =
            "Specify --ending-with (prefix extraction), --starting-with (suffix extraction), or --after-merge";
          error(msg);
          throw new ArbError(msg);
        }
        const direction: "prefix" | "suffix" = options.endingWith ? "prefix" : "suffix";
        const afterMerge = options.afterMerge === true;

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

        // ── Parse split points ──

        const rawSpecs = options.endingWith ?? options.startingWith ?? [];
        const specs = parseSplitPoints(Array.isArray(rawSpecs) ? rawSpecs : [rawSpecs]);

        // Compute merge-base per repo (needed for split point resolution and classifier)
        const mergeBaseMap = new Map<string, string>();
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

        // Resolve split points to per-repo SHAs
        const resolvedSplitPoints =
          specs.length > 0
            ? await resolveSplitPoints(specs, allRepos, wsDir, mergeBaseMap)
            : new Map<string, { repo: string; commitSha: string }>();

        // ── Assessment ──

        const shouldFetch = resolveDefaultFetch(options.fetch);
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
            let boundary = resolvedSplitPoints.get(repo)?.commitSha ?? null;

            // --from-merge: auto-detect boundary from merge detection
            if (afterMerge && !boundary && status.base?.merge?.newCommitsAfter != null) {
              const n = status.base.merge.newCommitsAfter;
              if (n > 0) {
                try {
                  // The first post-merge commit is the boundary (inclusive in extracted set)
                  const { stdout } = await gitLocal(repoDir, "rev-parse", `HEAD~${n - 1}`);
                  boundary = stdout.trim();
                } catch {
                  // Cannot resolve merge boundary — treat as no-op for this repo
                }
              }
            }

            const mb = mergeBaseMap.get(repo) ?? "";
            return assessExtractRepo(status, repoDir, branch, direction, targetBranch, boundary, mb, fetchFailed, {
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
          return nextAssessments;
        };

        const assessments = await runPlanFlow({
          shouldFetch,
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
        for (const a of willExtract) {
          const headResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
          const preHead = headResult.stdout.trim();
          if (!preHead) throw new ArbError(`Cannot capture HEAD for ${a.repo}`);
          const stashResult = await gitLocal(a.repoDir, "stash", "create");
          repoStates[a.repo] = {
            preHead,
            stashSha: stashResult.stdout.trim() || null,
            status: "skipped",
          };
        }
        // Also capture no-op repos for undo (they get new branches too)
        const noOps = assessments.filter((a) => a.outcome === "no-op");
        for (const a of noOps) {
          const headResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
          repoStates[a.repo] = {
            preHead: headResult.stdout.trim(),
            status: "skipped",
          };
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
          // Step 1: Create new branches in canonical repos
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
            createdBranches.push(a.repo);
          }

          // Step 2: Modify the original branch
          for (const a of willExtract) {
            if (!a.boundary) continue;

            if (direction === "prefix") {
              // Prefix: rebase original onto new branch (replay post-boundary commits)
              const n = a.commitsRemaining;
              inlineStart(a.repo, `rebasing ${n} ${plural(n, "commit", "commits")} onto ${targetBranch}`);

              const rebaseArgs = ["rebase"];
              if (a.needsStash) rebaseArgs.push("--autostash");
              rebaseArgs.push("--onto", targetBranch, a.boundary);

              const result = await gitLocal(a.repoDir, ...rebaseArgs);

              if (result.exitCode === 0) {
                const postHeadResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
                const existing = record.repos[a.repo];
                if (existing) {
                  record.repos[a.repo] = {
                    ...existing,
                    status: "completed",
                    postHead: postHeadResult.stdout.trim(),
                  };
                }
                writeOperationRecord(wsDir, record);
                inlineResult(a.repo, `rebased ${n} ${plural(n, "commit", "commits")} onto ${targetBranch}`);
                succeeded++;
              } else {
                const existing = record.repos[a.repo];
                if (existing) {
                  const errorOutput = result.stderr.trim().slice(0, 4000) || undefined;
                  record.repos[a.repo] = { ...existing, status: "conflicting", errorOutput };
                }
                writeOperationRecord(wsDir, record);
                inlineResult(a.repo, yellow("conflict"));
                conflicted.push({ assessment: a, stdout: result.stdout, stderr: result.stderr });
              }
            } else {
              // Suffix: reset original to just before the boundary
              const n = a.commitsExtracted;
              inlineStart(a.repo, `resetting to before ${plural(n, "commit", "commits")} extracted`);

              // Reset to the parent of the boundary commit
              const resetTarget = `${a.boundary}~1`;
              const result = await gitLocal(a.repoDir, "reset", "--hard", resetTarget);

              if (result.exitCode === 0) {
                const postHeadResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
                const existing = record.repos[a.repo];
                if (existing) {
                  record.repos[a.repo] = {
                    ...existing,
                    status: "completed",
                    postHead: postHeadResult.stdout.trim(),
                  };
                }
                writeOperationRecord(wsDir, record);
                inlineResult(a.repo, `reset — ${n} ${plural(n, "commit", "commits")} moved to ${targetBranch}`);
                succeeded++;
              } else {
                // reset --hard shouldn't fail, but handle it anyway
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
          }
        });

        // Conflict report (only possible for prefix extraction)
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

        // Create new workspace and finalize
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
        const parts: string[] = [];
        if (succeeded > 0) parts.push(`Extracted ${plural(succeeded, "repo")}`);
        if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
        if (noOps.length > 0) parts.push(`${noOps.length} unchanged`);
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        finishSummary(parts, conflicted.length > 0);

        if (conflicted.length === 0 && succeeded > 0) {
          process.stderr.write(`\nNew workspace: ${workspaceName}\n`);
        }
      }),
    );
}

// ── Plan formatting ──

function formatExtractPlan(
  assessments: ExtractAssessment[],
  workspace: string,
  targetWorkspace: string,
  targetBranch: string,
  direction: "prefix" | "suffix",
  configBase: string | null,
  endpoints?: Map<string, { extractEnd: string; remainEnd: string }>,
): string {
  const nodes = buildExtractPlanNodes(
    assessments,
    workspace,
    targetWorkspace,
    targetBranch,
    direction,
    configBase,
    endpoints,
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
): OutputNode[] {
  // TODO: add verbose plan with per-commit listing when --verbose is implemented
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
      let extractedText: string;
      let remainingText: string;
      if (direction === "prefix") {
        // Prefix: extracted ends at boundary, remaining starts after boundary. Stash on "stays" (rebased).
        const endNote = ep?.extractEnd ? `, ending with ${ep.extractEnd}` : "";
        const startNote = ep?.remainEnd ? `, starting with ${ep.remainEnd}` : "";
        extractedText = a.commitsExtracted > 0 ? `${plural(a.commitsExtracted, "commit", "commits")}${endNote}` : "–";
        remainingText =
          a.commitsRemaining > 0
            ? `${plural(a.commitsRemaining, "commit", "commits")}${startNote}${stashNote}`
            : `–${stashNote}`;
      } else {
        // Suffix: extracted starts at boundary, remaining ends before boundary. Stash on "new" (original is reset).
        const startNote = ep?.extractEnd ? `, starting with ${ep.extractEnd}` : "";
        const endNote = ep?.remainEnd ? `, ending with ${ep.remainEnd}` : "";
        extractedText =
          a.commitsExtracted > 0 ? `${plural(a.commitsExtracted, "commit", "commits")}${startNote}${stashNote}` : "–";
        remainingText = a.commitsRemaining > 0 ? `${plural(a.commitsRemaining, "commit", "commits")}${endNote}` : "–";
      }
      newCell = cell(extractedText);
      origCell = cell(remainingText);
    } else if (a.outcome === "no-op") {
      const remainingText = a.commitsRemaining > 0 ? `${plural(a.commitsRemaining, "commit", "commits")}` : "–";
      newCell = cell("–", "muted");
      origCell = cell(remainingText, "muted");
    } else {
      // skip
      newCell = skipCell(a.skipReason, a.skipFlag);
      origCell = cell("");
    }

    if (direction === "prefix") {
      return { cells: { repo: cell(a.repo), new: newCell, orig: origCell } };
    }
    return { cells: { repo: cell(a.repo), orig: origCell, new: newCell } };
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
