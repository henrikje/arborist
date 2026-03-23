import { type RelativeTimeParts, formatRelativeTimeParts } from "../core/time";
import { computeFlags } from "../status/flags";
import type { WorkspaceSummary } from "../status/types";
import type { VerboseDetail } from "../status/verbose-detail";
import {
  analyzeBaseDiff,
  analyzeBaseName,
  analyzeBranch,
  analyzeLocal,
  analyzeRemoteDiff,
  analyzeRemoteName,
} from "./analysis";
import { EMPTY_CELL, type OutputNode, type TableColumnDef, type TableNode, type TableRow, cell } from "./model";
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

  // Hide baseName column when all repos share the same rendered base ref
  const showBaseRef = (() => {
    const bases = repos.map((r) => r.base).filter((b) => b !== null);
    if (bases.length <= 1) {
      // Single repo (or none): hide if base is the default (no configuredRef)
      return bases.some((b) => b.configuredRef !== null);
    }
    const refs = new Set(
      bases.map((b) => {
        const branch = b.configuredRef ?? b.ref;
        return b.remote ? `${b.remote}/${branch}` : branch;
      }),
    );
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
    { header: "", key: "lastCommitUnit", group: "LAST COMMIT" },
    { header: "", key: "baseName", group: "BASE", truncate: { min: 13 }, show: showBaseRef },
    { header: "", key: "baseDiff", group: "BASE" },
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
    const firstBase = summary.repos.find((r) => r.base)?.base;
    if (firstBase) {
      const branch = firstBase.configuredRef ?? firstBase.ref;
      const ref = firstBase.remote ? `${firstBase.remote}/${branch}` : branch;
      parts.push(`base ${ref}`);
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
