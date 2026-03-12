export {
  type CommitMatchResult,
  detectRebasedCommits,
  detectReplacedCommits,
  detectSquashedCommits,
  matchDivergedCommits,
} from "./commit-matching";
export { predictMergeConflict, predictRebaseConflictCommits, predictStashPopConflict } from "./conflict-prediction";
export {
  type MergeDetectionResult,
  detectBranchMerged,
  findMergeCommitForBranch,
  findTicketReferencedCommit,
  verifySquashRange,
} from "./merge-detection";
export {
  crossMatchPatchIds,
  computeCumulativePatchId,
  computeDiffTreePatchId,
  computePatchIds,
  parsePatchIdOutput,
} from "./patch-id";
export { type ReplayPlanAnalysis, analyzeReplayPlan, analyzeRetargetReplay } from "./replay-analysis";
