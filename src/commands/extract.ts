import { existsSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { type Command, Option } from "commander";
import {
  ArbError,
  type OperationRecord,
  type RepoOperationState,
  arbAction,
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
      new Option("--to <specs...>", "Extract prefix (base through boundary) into new workspace")
        .conflicts("from")
        .conflicts("fromMerge"),
    )
    .addOption(
      new Option("--from <specs...>", "Extract suffix (boundary through tip) into new workspace")
        .conflicts("to")
        .conflicts("fromMerge"),
    )
    .addOption(
      new Option("--from-merge", "Extract suffix after merge point (auto-detect)").conflicts("to").conflicts("from"),
    )
    .option("-b, --branch <name>", "Branch name for new workspace (defaults to workspace name)")
    .option("--fetch", "Fetch from all remotes before extract (default)")
    .option("-N, --no-fetch", "Skip fetching before extract")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show per-commit details in the plan")
    .option("--autostash", "Stash uncommitted changes before operation")
    .option("--include-wrong-branch", "Include repos on a different branch than the workspace")
    .summary("Extract commits into a new workspace")
    .description(
      "Examples:\n\n  arb extract prereq --to abc123             Extract prefix into 'prereq'\n  arb extract cont --from abc123              Extract suffix into 'cont'\n  arb extract cont --from-merge               Extract post-merge commits\n  arb extract prereq --to abc123,def456       Multiple repos (auto-detect)\n  arb extract prereq --to api:HEAD~3          Per-repo with explicit prefix\n\nSplits the current workspace's branch at a boundary commit, creating a new stacked workspace.\n\nWith --to, extracts the prefix (base through boundary) into a new lower workspace. The original workspace is rebased to stack on top.\n\nWith --from, extracts the suffix (boundary through tip) into a new upper workspace. The original workspace is reset to the boundary.\n\nWith --from-merge, auto-detects the merge point for repos where the branch was merged.\n\nSplit points are specified as commit SHAs (auto-detect repo), <repo>:<commit-ish> (explicit), or tags. Multiple values can be comma-separated.\n\nRepos without an explicit split point have zero commits extracted — they are included in both workspaces but just track the base.",
    )
    .action(
      arbAction(async (ctx, workspaceName: string, options) => {
        // TODO Phase 6: add --continue/--abort gates and assertNoInProgressOperation(wsDir)

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
        if (!options.to && !options.from && !options.fromMerge) {
          const msg = "Specify --to (prefix extraction), --from (suffix extraction), or --from-merge";
          error(msg);
          throw new ArbError(msg);
        }
        if (options.fromMerge) {
          const msg = "--from-merge is not yet implemented";
          error(msg);
          throw new ArbError(msg);
        }
        const direction: "prefix" | "suffix" = options.to ? "prefix" : "suffix";

        const targetBranch = options.branch ?? workspaceName;

        // ── Current workspace context ──

        const { wsDir, workspace } = requireWorkspace(ctx);
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

        const rawSpecs = options.to ?? options.from ?? [];
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
          classify: ({ repo, repoDir, status, fetchFailed }) => {
            const resolved = resolvedSplitPoints.get(repo);
            const mb = mergeBaseMap.get(repo) ?? "";
            return assessExtractRepo(
              status,
              repoDir,
              branch,
              direction,
              targetBranch,
              resolved?.commitSha ?? null,
              mb,
              fetchFailed,
              { autostash, includeWrongBranch },
            );
          },
        });

        const postAssess = async (nextAssessments: ExtractAssessment[]) => {
          // Compute commit counts for will-extract repos
          for (const a of nextAssessments) {
            if (a.outcome !== "will-extract" || !a.boundary) continue;
            try {
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
              } else {
                // Extracted = boundary to HEAD (inclusive of boundary)
                // rev-list boundary..HEAD gives commits after boundary, add 1 for boundary itself
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
            formatExtractPlan(nextAssessments, workspace, workspaceName, targetBranch, direction, configBase),
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
          message: `Extract ${willExtract.length} ${plural(willExtract.length, "repo", "repos")}?`,
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
                // Suffix: new branch at HEAD (upper workspace gets commits from boundary onward)
                startPoint = "HEAD";
              }
            } else {
              // No-op repo
              if (direction === "prefix") {
                startPoint = mergeBaseMap.get(a.repo) ?? "HEAD";
              } else {
                startPoint = "HEAD";
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
          await addWorktrees(workspaceName, targetBranch, allRepos, ctx.reposDir, ctx.arbRootDir);

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
): string {
  const nodes = buildExtractPlanNodes(assessments, workspace, targetWorkspace, targetBranch, direction, configBase);
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
  const newLabel = `${targetWorkspace} (new)`;
  const origLabel = `${workspace} (stays)`;

  const rows = assessments.map((a) => {
    let newCell: Cell;
    let origCell: Cell;

    if (a.outcome === "will-extract") {
      const extractedText =
        a.commitsExtracted > 0 ? `${a.commitsExtracted} ${plural(a.commitsExtracted, "commit", "commits")}` : "–";
      const remainingText =
        a.commitsRemaining > 0 ? `${a.commitsRemaining} ${plural(a.commitsRemaining, "commit", "commits")}` : "–";
      newCell = cell(extractedText);
      origCell = cell(remainingText);
    } else if (a.outcome === "no-op") {
      const remainingText =
        a.commitsRemaining > 0 ? `${a.commitsRemaining} ${plural(a.commitsRemaining, "commit", "commits")}` : "–";
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
          { header: newLabel.toUpperCase(), key: "new" },
          { header: origLabel.toUpperCase(), key: "orig" },
        ]
      : [
          { header: "REPO", key: "repo" },
          { header: origLabel.toUpperCase(), key: "orig" },
          { header: newLabel.toUpperCase(), key: "new" },
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
