import { basename } from "node:path";
import { type Command, Option } from "commander";
import { predictMergeConflict } from "../lib/analysis";
import { predictStashPopConflict } from "../lib/analysis/conflict-prediction";
import {
  ArbError,
  type OperationRecord,
  type RepoOperationState,
  arbAction,
  assertNoInProgressOperation,
  readInProgressOperation,
  readWorkspaceConfig,
  writeOperationRecord,
  writeWorkspaceConfig,
} from "../lib/core";
import { getCommitsBetweenFull, gitLocal } from "../lib/git";
import { finishSummary, render } from "../lib/render";
import type { RenderContext } from "../lib/render";
import type { Cell, OutputNode } from "../lib/render";
import { skipCell, upToDateCell, verboseCommitsToNodes } from "../lib/render";
import { cell } from "../lib/render";
import { buildConflictReport } from "../lib/render/conflict-report";
import { type IntegrateActionDesc, integrateActionCell } from "../lib/render/integrate-cells";
import { RETARGET_EXEMPT_SKIPS } from "../lib/status";
import {
  VERBOSE_COMMIT_LIMIT,
  buildCachedStatusAssess,
  confirmOrExit,
  resolveDefaultFetch,
  runPlanFlow,
} from "../lib/sync";
import { assessRetargetRepo } from "../lib/sync/classify-retarget";
import { runContinueFlow } from "../lib/sync/continue-flow";
import type { RetargetAssessment } from "../lib/sync/types";
import { dryRunNotice, error, info, inlineResult, inlineStart, plural, yellow } from "../lib/terminal";
import { shouldColor } from "../lib/terminal/tty";
import { requireBranch, requireWorkspace, workspaceRepoDirs } from "../lib/workspace";
import { rejectExplicitBaseRemotePrefix, resolveWorkspaceBaseResolution } from "../lib/workspace/base";
import { workspaceBranch } from "../lib/workspace/branch";

export function registerRetargetCommand(program: Command): void {
  program
    .command("retarget [branch]")
    .option("--fetch", "Fetch from all remotes before retarget (default)")
    .option("-N, --no-fetch", "Skip fetching before retarget")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show incoming commits in the plan")
    .option("-g, --graph", "Show branch divergence graph in the plan")
    .option("--autostash", "Stash uncommitted changes before rebase, re-apply after")
    .option("--include-wrong-branch", "Include repos on a different branch than the workspace")
    .addOption(new Option("--continue", "Resume after resolving conflicts").conflicts("abort"))
    .addOption(
      new Option("--abort", "Cancel the in-progress retarget and restore pre-retarget state").conflicts("continue"),
    )
    .summary("Change the base branch and rebase onto it")
    .description(
      "Examples:\n\n  arb retarget feature1                    Retarget onto feature1\n  arb retarget                             Retarget onto the default branch\n  arb retarget feature1 --verbose          Show commits in the plan\n\nChanges the workspace's base branch and rebases all repos onto the new base. This is the \"I want to change what my workspace is based on\" command.\n\nWith a branch argument, retargets onto that branch — useful for stacking onto a feature branch, switching between base branches, or retargeting after the base branch has been merged. Without a branch argument, retargets onto each repo's default branch (e.g. main) and removes the configured base.\n\nWhen the old base was merged (squash or regular), uses 'git rebase --onto' to replay only your commits. When the old base was not merged, uses the same mechanism to graft your commits onto the new base.\n\nRequires a configured base branch or an explicit branch argument. If no base is configured and no branch is given, this is an error — use 'arb retarget <branch>' to set a base.\n\nAll-or-nothing: if any repo is blocked (dirty, wrong branch, etc.), the entire retarget is refused so the workspace config stays consistent. Use --autostash to stash uncommitted changes before rebasing.\n\nAlways operates on all repos in the workspace — retarget is a structural change to the workspace, not a per-repo operation. To change the base config without rebasing, or to rebase selectively, use 'arb branch base <branch>' then 'arb rebase [repos...]'.\n\nUse --verbose to show the incoming commits for each repo in the plan. Use --graph to show a branch divergence diagram. See 'arb help stacked' for stacked workspace workflows.",
    )
    .action(
      arbAction(async (ctx, branchArg: string | undefined, options) => {
        const { wsDir, workspace } = requireWorkspace(ctx);

        // ── Operation lifecycle: --continue, --abort, gate ──
        if ((options.continue || options.abort) && branchArg) {
          const flag = options.continue ? "--continue" : "--abort";
          error(`${flag} does not accept a branch argument`);
          throw new ArbError(`${flag} does not accept a branch argument`);
        }

        const inProgress = readInProgressOperation(wsDir, "retarget") as
          | (OperationRecord & { command: "retarget" })
          | null;

        if (options.abort) {
          if (!inProgress) {
            error("No retarget in progress. Nothing to abort.");
            throw new ArbError("No retarget in progress. Nothing to abort.");
          }
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
            error("No retarget in progress. Nothing to continue.");
            throw new ArbError("No retarget in progress. Nothing to continue.");
          }
          const configFile = `${wsDir}/.arbws/config.json`;
          await runContinueFlow({
            record: inProgress,
            wsDir,
            mode: "retarget",
            gitContinueCmd: "rebase",
            options,
            onComplete: (rec) => {
              if (rec.configAfter) {
                writeWorkspaceConfig(configFile, rec.configAfter);
                inlineResult(workspace, `base branch changed from ${inProgress.oldBase} to ${inProgress.targetBranch}`);
              }
            },
          });
          return;
        }

        await assertNoInProgressOperation(wsDir);

        const branch = await requireBranch(wsDir, workspace);
        const configFile = `${wsDir}/.arbws/config.json`;
        const configBase = readWorkspaceConfig(configFile)?.base ?? null;

        // No configured base and no explicit branch -> error
        if (!branchArg && !configBase) {
          error("No configured base — nothing to retarget.");
          error("Use 'arb retarget <branch>' to set a base.");
          throw new ArbError("No configured base — nothing to retarget.");
        }

        // Reject remote-qualified input (e.g. "origin/main" → "Use 'main' instead")
        let targetBranch = branchArg ?? null; // null = auto-detect default
        if (targetBranch) {
          const workspaceBaseResolution = await resolveWorkspaceBaseResolution(wsDir, ctx.reposDir, ctx.cache);
          const normalized = rejectExplicitBaseRemotePrefix(targetBranch, workspaceBaseResolution);
          if (normalized !== null) targetBranch = normalized;
        }

        // Cannot retarget to the current feature branch
        if (targetBranch === branch) {
          error(`Cannot retarget to ${targetBranch} — that is the current feature branch.`);
          throw new ArbError(`Cannot retarget to ${targetBranch} — that is the current feature branch.`);
        }

        // Cannot retarget to the current base branch
        if (targetBranch === configBase) {
          error(`Cannot retarget to ${targetBranch} — that is already the configured base branch.`);
          throw new ArbError(`Cannot retarget to ${targetBranch} — that is already the configured base branch.`);
        }
        const cache = ctx.cache;
        const remotesMap = await cache.resolveRemotesMap(
          workspaceRepoDirs(wsDir).map((d) => basename(d)),
          ctx.reposDir,
        );

        const shouldFetch = resolveDefaultFetch(options.fetch);
        const allFetchDirs = workspaceRepoDirs(wsDir);
        const allRepos = allFetchDirs.map((d) => basename(d));

        // Phase 2: assess
        const autostash = options.autostash === true;
        const includeWrongBranch = options.includeWrongBranch === true;

        const assess = buildCachedStatusAssess<RetargetAssessment>({
          repos: allRepos,
          wsDir,
          reposDir: ctx.reposDir,
          branch,
          configBase,
          remotesMap,
          cache,
          analysisCache: ctx.analysisCache,
          classify: ({ repoDir, status, fetchFailed }) => {
            const repoPath = `${ctx.reposDir}/${basename(repoDir)}`;
            return assessRetargetRepo(
              status,
              repoDir,
              branch,
              targetBranch,
              fetchFailed,
              {
                autostash,
                includeWrongBranch,
                cache,
              },
              {
                remoteBranchExists: (_dir, b, r) => cache.remoteBranchExists(repoPath, b, r),
                branchExistsLocally: (_dir, b) => cache.branchExistsLocally(repoPath, b),
              },
            );
          },
        });

        const postAssess = async (nextAssessments: RetargetAssessment[]) => {
          await predictRetargetConflicts(nextAssessments);
          if (options.verbose) {
            await gatherRetargetVerboseCommits(nextAssessments);
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
          formatPlan: (nextAssessments) => formatRetargetPlan(nextAssessments, workspace, options.verbose),
          onPostFetch: () => cache.invalidateAfterFetch(),
        });

        // Phase 3: all-or-nothing check
        const willRetarget = assessments.filter((a) => a.outcome === "will-retarget");
        const upToDate = assessments.filter((a) => a.outcome === "up-to-date");
        const skipped = assessments.filter((a) => a.outcome === "skip");

        // When at least one repo can retarget, check that no repos are blocked
        if (willRetarget.length > 0 || upToDate.length > 0) {
          const blockedRepos = assessments.filter(
            (a) => a.outcome === "skip" && (a.skipFlag == null || !RETARGET_EXEMPT_SKIPS.has(a.skipFlag)),
          );
          if (blockedRepos.length > 0) {
            error("Cannot retarget: some repos are blocked. Fix these issues and retry:");
            for (const a of blockedRepos) {
              process.stderr.write(`  ${a.repo} — ${a.skipReason}\n`);
            }
            throw new ArbError("Cannot retarget: some repos are blocked.");
          }
        }

        // When all repos are skipped, ensure at least one could retarget
        if (willRetarget.length === 0 && upToDate.length === 0 && skipped.length > 0) {
          error("Cannot retarget: target branch not found on any repo.");
          throw new ArbError("Cannot retarget: target branch not found on any repo.");
        }

        if (willRetarget.length === 0) {
          // If all up-to-date, still update config if needed
          if (upToDate.length > 0) {
            const wroteConfig = await maybeWriteRetargetConfig({
              dryRun: options.dryRun,
              wsDir,
              branch,
              assessments,
              cache,
            });
            if (wroteConfig) {
              const first = assessments.find((a) => a.outcome === "up-to-date");
              if (first) {
                const configDesc =
                  first.targetBranch === first.oldBase
                    ? "already on target"
                    : `base branch changed from ${first.oldBase} to ${first.targetBranch}`;
                inlineResult(workspace, configDesc);
                process.stderr.write("\n");
              }
            }
            info("All repos up to date");
          } else {
            info("Nothing to do");
          }
          return;
        }

        if (options.dryRun) {
          dryRunNotice();
          return;
        }

        // Phase 4: confirm
        await confirmOrExit({
          yes: options.yes,
          message: `Retarget ${plural(willRetarget.length, "repo")}?`,
        });

        process.stderr.write("\n");

        // Phase 5: capture state and write operation record
        const configBefore = readWorkspaceConfig(configFile) ?? { branch };
        const first = willRetarget[0];
        const configAfter = first ? await buildRetargetConfigAfter(wsDir, branch, first, cache) : configBefore;

        const repoStates: Record<string, RepoOperationState> = {};
        for (const a of willRetarget) {
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

        const record: OperationRecord = {
          command: "retarget",
          startedAt: new Date().toISOString(),
          status: "in-progress",
          repos: repoStates,
          targetBranch: first?.targetBranch ?? "",
          oldBase: first?.oldBase ?? "",
          configBefore,
          configAfter,
        };
        writeOperationRecord(wsDir, record);

        // Phase 6: execute
        let succeeded = 0;
        const conflicted: { assessment: RetargetAssessment; stdout: string; stderr: string }[] = [];

        for (const a of willRetarget) {
          const targetRef = `${a.baseRemote}/${a.targetBranch}`;

          // Resolve old base ref: check remote first, fall back to local
          const repoPath = `${ctx.reposDir}/${a.repo}`;
          const oldBaseRemoteExists = await cache.remoteBranchExists(repoPath, a.oldBase, a.baseRemote);
          const oldBaseRef = oldBaseRemoteExists ? `${a.baseRemote}/${a.oldBase}` : a.oldBase;

          const n = a.replayCount ?? 0;
          const progressMsg = a.baseMerged
            ? `rebasing ${n} new ${n === 1 ? "commit" : "commits"} onto ${targetRef} (merged)`
            : `rebasing ${a.branch} onto ${targetRef} from ${a.oldBase} (retarget)`;
          inlineStart(a.repo, progressMsg);

          const rebaseArgs = ["rebase"];
          if (a.needsStash) rebaseArgs.push("--autostash");
          rebaseArgs.push("--onto", targetRef, oldBaseRef);

          const result = await gitLocal(a.repoDir, ...rebaseArgs);

          if (result.exitCode === 0) {
            const postHeadResult = await gitLocal(a.repoDir, "rev-parse", "HEAD");
            const existing = record.repos[a.repo];
            if (existing) {
              record.repos[a.repo] = { ...existing, status: "completed", postHead: postHeadResult.stdout.trim() };
            }
            writeOperationRecord(wsDir, record);

            const doneMsg = a.baseMerged
              ? `rebased ${n} new ${n === 1 ? "commit" : "commits"} onto ${targetRef} (merged)`
              : `rebased ${a.branch} onto ${targetRef} from ${a.oldBase} (retarget)`;
            inlineResult(a.repo, doneMsg);
            succeeded++;
          } else {
            const existing = record.repos[a.repo];
            if (existing) {
              record.repos[a.repo] = { ...existing, status: "conflicting" };
            }
            writeOperationRecord(wsDir, record);

            inlineResult(a.repo, yellow("conflict"));
            conflicted.push({ assessment: a, stdout: result.stdout, stderr: result.stderr });
          }
        }

        // Phase 7: conflict report
        const conflictNodes = buildConflictReport(
          conflicted.map((c) => ({
            repo: c.assessment.repo,
            stdout: c.stdout,
            stderr: c.stderr,
            subcommand: "rebase" as const,
          })),
        );
        const reportCtx = { tty: shouldColor() };
        if (conflictNodes.length > 0) process.stderr.write(render(conflictNodes, reportCtx));

        // Phase 8: finalize operation record + deferred config
        if (conflicted.length === 0) {
          // All succeeded — apply deferred config and mark completed
          writeWorkspaceConfig(configFile, configAfter);
          record.status = "completed";
          writeOperationRecord(wsDir, record);

          if (first) {
            const configDesc = `base branch changed from ${first.oldBase} to ${first.targetBranch}`;
            inlineResult(workspace, configDesc);
          }
        } else {
          // Conflicts — config NOT updated (this is the bug fix)
          info("Use 'arb retarget --continue' to resume or 'arb retarget --abort' to cancel");
        }

        // Phase 9: summary
        process.stderr.write("\n");
        const parts: string[] = [];
        if (succeeded > 0) parts.push(`Retargeted ${plural(succeeded, "repo")}`);
        if (conflicted.length > 0) parts.push(`${conflicted.length} conflicted`);
        if (upToDate.length > 0) parts.push(`${upToDate.length} up to date`);
        if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
        finishSummary(parts, conflicted.length > 0);
      }),
    );
}

// ── Config helpers ──

async function buildRetargetConfigAfter(
  wsDir: string,
  branch: string,
  first: RetargetAssessment,
  cache: { getDefaultBranch(repoDir: string, remote: string): Promise<string | null> },
): Promise<{ branch: string; base?: string }> {
  const wb = await workspaceBranch(wsDir);
  const wsBranch = wb?.branch ?? branch;
  const repoDefault = await cache.getDefaultBranch(first.repoDir, first.baseRemote);
  if (repoDefault && first.targetBranch !== repoDefault) {
    return { branch: wsBranch, base: first.targetBranch };
  }
  return { branch: wsBranch };
}

// ── Plan rendering ──

function formatRetargetPlan(assessments: RetargetAssessment[], workspace: string, verbose?: boolean): string {
  const nodes = buildRetargetPlanNodes(assessments, workspace, verbose);
  const envCols = Number(process.env.COLUMNS);
  const termCols = process.stdout.columns ?? (Number.isFinite(envCols) ? envCols : 0);
  const ctx: RenderContext = { tty: shouldColor(), terminalWidth: termCols > 0 ? termCols : undefined };
  return render(nodes, ctx);
}

function buildRetargetPlanNodes(assessments: RetargetAssessment[], workspace: string, verbose?: boolean): OutputNode[] {
  const nodes: OutputNode[] = [{ kind: "gap" }];

  const rows = assessments.map((a) => {
    let actionCell: Cell;
    if (a.outcome === "will-retarget") {
      actionCell = retargetActionCell(a);
    } else if (a.outcome === "up-to-date") {
      actionCell = upToDateCell();
    } else {
      actionCell = skipCell(a.skipReason ?? "", a.skipFlag);
    }

    let afterRow: OutputNode[] | undefined;
    if (verbose && a.outcome === "will-retarget" && a.verbose?.commits && a.verbose.commits.length > 0) {
      const label = `Incoming from ${a.baseRemote}/${a.targetBranch}:`;
      afterRow = verboseCommitsToNodes(a.verbose.commits, a.verbose.totalCommits ?? a.verbose.commits.length, label);
    }

    return {
      cells: { repo: cell(a.repo), action: actionCell },
      afterRow,
    };
  });

  nodes.push({
    kind: "table",
    columns: [
      { header: "REPO", key: "repo" },
      { header: "ACTION", key: "action" },
    ],
    rows,
  });

  // Config action hint
  const configAction = computeRetargetConfigAction(assessments, workspace);
  if (configAction) {
    nodes.push({ kind: "gap" });
    nodes.push({
      kind: "hint",
      cell: cell(`  [${configAction.workspace}] ${configAction.description}`),
    });
  }

  // Wrong branch repos hint
  const wrongBranchCount = assessments.filter((a) => a.wrongBranch && a.outcome === "will-retarget").length;
  if (wrongBranchCount > 0) {
    nodes.push({
      kind: "hint",
      cell: cell(`  hint: ${plural(wrongBranchCount, "repo")} on a different branch than the workspace`, "muted"),
    });
  }

  // Shallow clone warnings
  const shallowRepos = assessments.filter((a) => a.shallow);
  for (const a of shallowRepos) {
    nodes.push({
      kind: "message",
      level: "attention",
      text: `${a.repo} is a shallow clone; ahead/behind counts may be inaccurate and rebase may fail if the merge base is beyond the shallow boundary`,
    });
  }

  nodes.push({ kind: "gap" });
  return nodes;
}

function retargetActionCell(a: RetargetAssessment): Cell {
  const baseRef = `${a.baseRemote}/${a.targetBranch}`;
  const stash: IntegrateActionDesc["stash"] = !a.needsStash
    ? "none"
    : a.stashPopConflictFiles && a.stashPopConflictFiles.length > 0
      ? "pop-conflict-likely"
      : a.stashPopConflictFiles
        ? "pop-conflict-unlikely"
        : "autostash";

  const conflictRisk: IntegrateActionDesc["conflictRisk"] =
    a.conflictPrediction === "conflict"
      ? "likely"
      : a.conflictPrediction === "clean"
        ? "unlikely"
        : a.conflictPrediction === "no-conflict"
          ? "no-conflict"
          : null;

  let desc: IntegrateActionDesc;
  if (a.baseMerged) {
    desc = {
      kind: "retarget-merged",
      baseRef,
      branch: a.branch,
      replayCount: a.replayCount ?? 0,
      skipCount: a.alreadyOnTarget,
      conflictRisk: null,
      stash,
      warning: a.warning,
      headSha: a.headSha,
    };
  } else {
    desc = {
      kind: "retarget-config",
      baseRef,
      branch: a.branch,
      retargetFrom: a.oldBase,
      replayCount: a.replayCount,
      skipCount: a.alreadyOnTarget,
      conflictRisk,
      stash,
      warning: a.warning,
      headSha: a.headSha,
    };
  }

  return integrateActionCell(desc);
}

function computeRetargetConfigAction(
  assessments: RetargetAssessment[],
  workspace: string,
): { workspace: string; description: string } | null {
  const retargetable = assessments.filter((a) => a.outcome === "will-retarget" || a.outcome === "up-to-date");
  if (retargetable.length === 0) return null;

  const first = retargetable[0];
  if (!first) return null;

  const from = first.oldBase || "default";
  const to = first.targetBranch;
  return { workspace, description: `change base branch from ${from} to ${to}` };
}

// ── Post-assess helpers ──

async function predictRetargetConflicts(assessments: RetargetAssessment[]): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-retarget" && !a.baseMerged)
      .map(async (a) => {
        const targetRef = `${a.baseRemote}/${a.targetBranch}`;
        const prediction = await predictMergeConflict(a.repoDir, targetRef);
        a.conflictPrediction = prediction === null ? null : prediction.hasConflict ? "conflict" : "clean";
        if (a.needsStash) {
          const stashPrediction = await predictStashPopConflict(a.repoDir, targetRef);
          a.stashPopConflictFiles = stashPrediction.overlapping;
        }
      }),
  );
}

async function gatherRetargetVerboseCommits(assessments: RetargetAssessment[]): Promise<void> {
  await Promise.all(
    assessments
      .filter((a) => a.outcome === "will-retarget")
      .map(async (a) => {
        const targetRef = `${a.baseRemote}/${a.targetBranch}`;
        const commits = await getCommitsBetweenFull(a.repoDir, "HEAD", targetRef);
        const total = commits.length;
        a.verbose = {
          ...a.verbose,
          commits: commits.slice(0, VERBOSE_COMMIT_LIMIT).map((c) => ({
            shortHash: c.shortHash,
            subject: c.subject,
          })),
          totalCommits: total,
        };
      }),
  );
}

// ── Config update ──

async function maybeWriteRetargetConfig(options: {
  dryRun?: boolean;
  wsDir: string;
  branch: string;
  assessments: RetargetAssessment[];
  cache: { getDefaultBranch(repoDir: string, remote: string): Promise<string | null> };
}): Promise<boolean> {
  if (options.dryRun) return false;

  const retargetable = options.assessments.filter((a) => a.outcome === "will-retarget" || a.outcome === "up-to-date");
  if (retargetable.length === 0) return false;

  const first = retargetable[0];
  if (!first) return false;

  const configFile = `${options.wsDir}/.arbws/config.json`;
  const wb = await workspaceBranch(options.wsDir);
  const wsBranch = wb?.branch ?? options.branch;

  // Resolve the repo's default branch to check if target matches
  const repoDefault = await options.cache.getDefaultBranch(first.repoDir, first.baseRemote);
  if (repoDefault && first.targetBranch !== repoDefault) {
    // Retargeting to a non-default branch: set as new base
    writeWorkspaceConfig(configFile, { branch: wsBranch, base: first.targetBranch });
  } else {
    // Retargeting to the default branch: remove base (unstack)
    writeWorkspaceConfig(configFile, { branch: wsBranch });
  }
  return true;
}
