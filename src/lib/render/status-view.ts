import { formatRelativeTimeParts, type RelativeTimeParts } from "../core/time";
import { computeFlags } from "../status/flags";
import { baseRef } from "../status/status";
import type { WorkspaceSummary } from "../status/types";
import type { VerboseDetail } from "../status/verbose-detail";
import {
  analyzeBaseDiff,
  analyzeBaseName,
  analyzeBaseSource,
  analyzeBranch,
  analyzeLocal,
  analyzeRemoteDiff,
  analyzeRemoteName,
} from "./analysis";
import { cell, EMPTY_CELL, type OutputNode, type TableColumnDef, type TableNode, type TableRow } from "./model";
import { verboseDetailToNodes } from "./status-verbose";

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

export interface StatusViewResult {
  nodes: OutputNode[];
  showBaseRef: boolean;
  showShareRef: boolean;
}

/** Build the declarative OutputNode[] for the status table */
export function buildStatusView(summary: WorkspaceSummary, ctx: StatusViewContext): StatusViewResult {
  const repos = summary.repos;

  if (repos.length === 0) {
    return {
      nodes: [{ kind: "message", level: "muted", text: "(no repos)" }],
      showBaseRef: false,
      showShareRef: false,
    };
  }

  // Determine if BRANCH column is needed
  const showBranch = repos.some(
    (r) =>
      r.identity.headMode.kind === "detached" ||
      (r.identity.headMode.kind === "attached" && r.identity.headMode.branch !== ctx.expectedBranch),
  );

  // Hide baseName column when all repos share the same base branch name.
  // Compares branch names only — a mix of local/remote resolution for the same
  // branch doesn't force the column visible (the baseSource sub-column shows that).
  const showBaseRef = (() => {
    const bases = repos.map((r) => r.base).filter((b) => b !== null);
    if (bases.length <= 1) {
      // Single repo (or none): hide if base is the default (no configuredRef)
      return bases.some((b) => b.configuredRef !== null);
    }
    const refs = new Set(bases.map((b) => b.configuredRef ?? b.ref));
    return refs.size > 1;
  })();

  // Hide remoteName column when every repo's share ref matches the expected default
  const showShareRef = repos.some((r) => {
    if (r.identity.headMode.kind === "detached") return true;
    const branch = r.identity.headMode.branch;
    if (branch !== ctx.expectedBranch) return true;
    if (r.share.refMode === "configured" && r.share.ref) {
      return r.share.ref !== `${r.share.remote}/${branch}`;
    }
    return false;
  });

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
        branch: analyzeBranch(repo, ctx.expectedBranch),
        baseName: analyzeBaseName(repo, flags),
        baseDiff: analyzeBaseDiff(repo, flags, hasBaseConflict),
        baseSource: analyzeBaseSource(repo),
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
    { header: "BRANCH", key: "branch", show: showBranch },
    { header: "", key: "lastCommitNum", group: "LAST COMMIT", align: "right" as const },
    { header: "", key: "lastCommitUnit", group: "LAST COMMIT", subGap: 1 },
    { header: "", key: "baseName", group: "BASE", truncate: { min: 13 }, show: showBaseRef },
    { header: "", key: "baseDiff", group: "BASE" },
    { header: "", key: "baseSource", group: "BASE", show: "auto" },
    { header: "", key: "remoteName", group: "SHARE", truncate: { min: 13 }, show: showShareRef },
    { header: "", key: "remoteDiff", group: "SHARE" },
    { header: "LOCAL", key: "local" },
  ];

  const table: TableNode = { kind: "table", columns, rows };
  return { nodes: [table], showBaseRef, showShareRef };
}

/** Build a parenthetical string describing hidden ref columns, for use in headers.
 *  Returns null when both ref columns are visible (no header needed). */
export function buildRefParenthetical(
  summary: WorkspaceSummary,
  showBaseRef: boolean,
  showShareRef: boolean,
): string | null {
  const parts: string[] = [];

  // Branch — only when it differs from workspace name
  if (summary.branch !== summary.workspace) {
    parts.push(`branch ${summary.branch}`);
  }

  // Base ref — when column is hidden
  if (!showBaseRef) {
    if (summary.base) {
      // Configured base: prefer a repo that resolved it (configuredRef == null) over one that fell back
      const resolvedRepo = summary.repos.find((r) => r.base && r.base.configuredRef == null);
      if (resolvedRepo?.base) {
        parts.push(`base ${baseRef(resolvedRepo.base)}`);
      } else {
        const remote = summary.repos.find((r) => r.base)?.base?.remote;
        const display = remote ? `${remote}/${summary.base}` : summary.base;
        parts.push(`base ${display}`);
      }
    } else {
      const firstBase = summary.repos.find((r) => r.base)?.base;
      if (firstBase) {
        parts.push(`base ${baseRef(firstBase)}`);
      }
    }
  }

  // Share ref — when column is hidden
  if (!showShareRef) {
    const firstRepo = summary.repos[0];
    if (firstRepo) {
      parts.push(`share ${firstRepo.share.remote}/${summary.branch}`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : null;
}
