import { type RelativeTimeParts, formatRelativeTimeParts } from "../core/time";
import { type WorkspaceSummary, computeFlags } from "../status/status";
import {
  analyzeBaseDiff,
  analyzeBaseName,
  analyzeBranch,
  analyzeLocal,
  analyzeRemoteDiff,
  analyzeRemoteName,
} from "./analysis";
import { EMPTY_CELL, type OutputNode, type TableColumnDef, type TableNode, type TableRow, cell } from "./model";
import { type VerboseDetail, verboseDetailToNodes } from "./status-verbose";

export interface StatusViewContext {
  /** The expected branch name for this workspace */
  expectedBranch: string;
  /** Set of repo names with predicted conflicts against the base branch */
  baseConflictRepos: Set<string>;
  /** Set of repo names with predicted conflicts against the share tracking ref */
  pullConflictRepos: Set<string>;
  /** Name of the repo the user is currently cd'd into, if any */
  currentRepo: string | null;
  /** When provided, verbose detail is attached as afterRow nodes on each table row */
  verboseData?: Map<string, VerboseDetail | undefined>;
}

/** Build the declarative OutputNode[] for the status table */
export function buildStatusView(summary: WorkspaceSummary, ctx: StatusViewContext): OutputNode[] {
  const repos = summary.repos;

  if (repos.length === 0) {
    return [{ kind: "message", level: "muted", text: "(no repos)" }];
  }

  // Pre-compute last commit parts for column group alignment
  const lastCommitParts: RelativeTimeParts[] = repos.map((r) =>
    r.lastCommit ? formatRelativeTimeParts(r.lastCommit) : { num: "", unit: "" },
  );
  // Build rows
  const rows: TableRow[] = repos.map((repo, i) => {
    const flags = computeFlags(repo, ctx.expectedBranch);
    const hasBaseConflict = ctx.baseConflictRepos.has(repo.name);
    const hasPullConflict = ctx.pullConflictRepos.has(repo.name);
    const lc = lastCommitParts[i] ?? { num: "", unit: "" };

    const row: TableRow = {
      cells: {
        repo: cell(repo.name),
        branch: flags.isDrifted || flags.isDetached ? analyzeBranch(repo, ctx.expectedBranch) : EMPTY_CELL,
        baseName: analyzeBaseName(repo, flags),
        baseDiff: analyzeBaseDiff(repo, flags, hasBaseConflict),
        remoteName: analyzeRemoteName(repo, flags),
        remoteDiff: analyzeRemoteDiff(repo, flags, hasPullConflict),
        local: analyzeLocal(repo),
        lastCommitNum: lc.num ? cell(lc.num) : EMPTY_CELL,
        lastCommitUnit: lc.unit ? cell(lc.unit) : EMPTY_CELL,
      },
      marked: repo.name === ctx.currentRepo,
    };

    if (ctx.verboseData) {
      const detail = ctx.verboseData.get(repo.name);
      const afterNodes = verboseDetailToNodes(repo, detail);
      if (afterNodes.length > 0) {
        row.afterRow = afterNodes;
      } else if (i < repos.length - 1) {
        // Add row separation gap even when no verbose data
        row.afterRow = [{ kind: "gap" }];
      }
    }

    return row;
  });

  // Build column definitions
  const columns: TableColumnDef[] = [
    { header: "REPO", key: "repo" },
    { header: "BRANCH", key: "branch", show: "auto" },
    { header: "", key: "lastCommitNum", group: "LAST COMMIT", align: "right" as const },
    { header: "", key: "lastCommitUnit", group: "LAST COMMIT" },
    { header: "", key: "baseName", group: "BASE" },
    { header: "", key: "baseDiff", group: "BASE" },
    { header: "", key: "remoteName", group: "SHARE", truncate: { min: 10 } },
    { header: "", key: "remoteDiff", group: "SHARE" },
    { header: "LOCAL", key: "local" },
  ];

  const table: TableNode = { kind: "table", columns, rows };
  return [table];
}
