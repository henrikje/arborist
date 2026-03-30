export { plainBaseDiff, plainLocal, plainRemoteDiff } from "./analysis";
export { AnalysisCache } from "./analysis-cache";
export {
  computeFlags,
  computeSummaryAggregates,
  isAtRisk,
  isLocalDirty,
  isWorkspaceSafe,
  wouldLoseWork,
} from "./flags";
export { extractPrNumber } from "./pr-detection";
export { BENIGN_SKIPS, EXTRACT_EXEMPT_SKIPS, RETARGET_EXEMPT_SKIPS, type SkipFlag } from "./skip-flags";
export { baseRef, baseRemoteRef, gatherRepoRefs, gatherRepoStatus, gatherWorkspaceSummary } from "./status";
export { makeRepo } from "./test-helpers";
export { detectTicketFromName } from "./ticket-detection";
export {
  type AgeFilter,
  AT_RISK_FLAGS,
  FLAG_LABELS,
  LOSE_WORK_FLAGS,
  MERGED_IMPLIED_FLAGS,
  type RepoFlags,
  type RepoRefs,
  type RepoStatus,
  STALE_FLAGS,
  type WorkspaceSummary,
} from "./types";
export { gatherVerboseDetail, toJsonVerbose, type VerboseDetail } from "./verbose-detail";
export {
  matchesAge,
  repoMatchesWhere,
  resolveAgeFilter,
  resolveWhereFilter,
  validateWhere,
  workspaceMatchesWhere,
} from "./where";
