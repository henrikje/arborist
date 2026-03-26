import { renameSync } from "node:fs";
import { basename } from "node:path";
import type { OperationRecord } from "../../core/operation";
import { withReflogAction } from "../../core/operation";
import { detectOperation, gitLocal } from "../../git/git";
import { inlineResult, inlineStart } from "../../terminal/output";
import { workspaceRepoDirs } from "../../workspace/repos";
import type { RepoUndoAssessment, UndoResult } from "./types";

export async function executeBranchRenameUndo(
  record: OperationRecord & { command: "branch-rename" },
  assessments: RepoUndoAssessment[],
): Promise<UndoResult> {
  let undone = 0;
  const undoneRepos: string[] = [];
  const failures: string[] = [];

  await withReflogAction("arb-undo", async () => {
    for (const a of assessments) {
      if (a.action !== "needs-undo") continue;

      inlineStart(a.repo, "reverting");
      const result = await gitLocal(a.repoDir, "branch", "-m", record.newBranch, record.oldBranch);
      if (result.exitCode === 0) {
        const state = record.repos[a.repo];
        if (state?.tracking?.remote) {
          await gitLocal(a.repoDir, "config", `branch.${record.oldBranch}.remote`, state.tracking.remote);
        } else {
          await gitLocal(a.repoDir, "config", "--unset", `branch.${record.oldBranch}.remote`);
        }
        if (state?.tracking?.merge) {
          await gitLocal(a.repoDir, "config", `branch.${record.oldBranch}.merge`, state.tracking.merge);
        } else {
          await gitLocal(a.repoDir, "config", "--unset", `branch.${record.oldBranch}.merge`);
        }
        inlineResult(a.repo, `reverted to ${record.oldBranch}`);
        undone++;
        undoneRepos.push(a.repo);
      } else {
        inlineResult(a.repo, "failed to revert");
        failures.push(a.repo);
      }
    }
  });

  return { undone, undoneRepos, failures };
}

export async function executeRenameUndo(
  record: OperationRecord & { command: "rename" },
  assessments: RepoUndoAssessment[],
  _wsDir: string,
  arbRootDir: string,
  reposDir: string,
  options?: { skipDirectoryRename?: boolean },
): Promise<UndoResult> {
  let undone = 0;
  const undoneRepos: string[] = [];
  const failures: string[] = [];

  const oldBranch = record.configBefore?.branch;
  const newBranch = record.configAfter?.branch;

  await withReflogAction("arb-undo", async () => {
    if (oldBranch && newBranch && oldBranch !== newBranch) {
      for (const a of assessments) {
        if (a.action !== "needs-undo") continue;

        inlineStart(a.repo, "reverting branch");
        const result = await gitLocal(a.repoDir, "branch", "-m", newBranch, oldBranch);
        if (result.exitCode === 0) {
          const state = record.repos[a.repo];
          if (state?.tracking?.remote) {
            await gitLocal(a.repoDir, "config", `branch.${oldBranch}.remote`, state.tracking.remote);
          } else {
            await gitLocal(a.repoDir, "config", "--unset", `branch.${oldBranch}.remote`);
          }
          if (state?.tracking?.merge) {
            await gitLocal(a.repoDir, "config", `branch.${oldBranch}.merge`, state.tracking.merge);
          } else {
            await gitLocal(a.repoDir, "config", "--unset", `branch.${oldBranch}.merge`);
          }
          inlineResult(a.repo, `reverted to ${oldBranch}`);
          undone++;
          undoneRepos.push(a.repo);
        } else {
          inlineResult(a.repo, "failed to revert branch");
          failures.push(a.repo);
        }
      }
    }

    if (!options?.skipDirectoryRename && record.oldName !== record.newName) {
      const currentWsDir = `${arbRootDir}/${record.newName}`;
      const targetWsDir = `${arbRootDir}/${record.oldName}`;
      try {
        renameSync(currentWsDir, targetWsDir);
        inlineResult(record.newName, `workspace renamed back to ${record.oldName}`);

        const repos = workspaceRepoDirs(targetWsDir).map((d) => basename(d));
        for (const repo of repos) {
          Bun.spawnSync(["git", "worktree", "repair", `${targetWsDir}/${repo}`], {
            cwd: `${reposDir}/${repo}`,
            stdout: "ignore",
            stderr: "ignore",
          });
        }
      } catch {
        failures.push(`${record.newName} (directory rename failed)`);
      }
    }
  });

  return { undone, undoneRepos, failures };
}

export async function executeSyncUndo(record: OperationRecord, assessments: RepoUndoAssessment[]): Promise<UndoResult> {
  let undone = 0;
  const undoneRepos: string[] = [];
  const failures: string[] = [];

  await withReflogAction("arb-undo", async () => {
    for (const a of assessments) {
      if (a.action !== "needs-abort") continue;

      inlineStart(a.repo, "aborting");
      const op = await detectOperation(a.repoDir);
      const abortCmd = op === "merge" ? "merge" : "rebase";
      const result = await gitLocal(a.repoDir, abortCmd, "--abort");
      if (result.exitCode === 0) {
        inlineResult(a.repo, `aborted ${abortCmd}`);
        undone++;
        undoneRepos.push(a.repo);
      } else {
        inlineResult(a.repo, `failed to abort ${abortCmd}`);
        failures.push(a.repo);
      }
    }

    for (const a of assessments) {
      if (a.action !== "needs-undo") continue;

      const state = record.repos[a.repo];
      if (!state) continue;

      inlineStart(a.repo, "restoring");
      const result = await gitLocal(a.repoDir, "reset", "--hard", state.preHead);
      if (result.exitCode === 0) {
        if (state.stashSha) {
          const stashResult = await gitLocal(a.repoDir, "stash", "apply", "--index", state.stashSha);
          if (stashResult.exitCode !== 0) {
            const fallbackResult = await gitLocal(a.repoDir, "stash", "apply", state.stashSha);
            if (fallbackResult.exitCode !== 0) {
              inlineResult(
                a.repo,
                `restored to ${state.preHead.slice(0, 7)} (stash restore failed — run 'git stash apply ${state.stashSha}' manually)`,
              );
              undone++;
              undoneRepos.push(a.repo);
              continue;
            }
          }
        }
        inlineResult(a.repo, `restored to ${state.preHead.slice(0, 7)}`);
        undone++;
        undoneRepos.push(a.repo);
      } else {
        inlineResult(a.repo, "failed to restore");
        failures.push(a.repo);
      }
    }
  });

  return { undone, undoneRepos, failures };
}
