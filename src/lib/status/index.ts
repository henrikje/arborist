export { plainBaseDiff, plainLocal, plainRemoteDiff } from "./analysis";
export {
  computeFlags,
  computeSummaryAggregates,
  isAtRisk,
  isLocalDirty,
  isWorkspaceSafe,
  wouldLoseWork,
} from "./flags";
export { extractPrNumber } from "./pr-detection";
export { type SkipFlag, BENIGN_SKIPS } from "./skip-flags";
export { baseRef, gatherRepoStatus, gatherWorkspaceSummary } from "./status";
export { makeRepo } from "./test-helpers";
export { type VerboseDetail, gatherVerboseDetail, toJsonVerbose } from "./verbose-detail";
export { detectTicketFromName } from "./ticket-detection";
export {
  AT_RISK_FLAGS,
  type AgeFilter,
  FLAG_LABELS,
  LOSE_WORK_FLAGS,
  MERGED_IMPLIED_FLAGS,
  type RepoFlags,
  type RepoStatus,
  STALE_FLAGS,
  type WorkspaceSummary,
} from "./types";
export {
  matchesAge,
  repoMatchesWhere,
  resolveAgeFilter,
  resolveWhereFilter,
  validateWhere,
  workspaceMatchesWhere,
} from "./where";
