export {
  type CommitMatchResult,
  detectRebasedCommits,
  detectReplacedCommits,
  detectSquashedCommits,
  matchDivergedCommits,
} from "./commit-matching";
export { predictMergeConflict, predictRebaseConflictCommits, predictStashPopConflict } from "./conflict-prediction";
export {
  detectBranchMerged,
  findMergeCommitForBranch,
  findTicketReferencedCommit,
  type MergeDetectionResult,
  verifySquashRange,
} from "./merge-detection";
export {
  computeCumulativePatchId,
  computeDiffTreePatchId,
  computePatchIds,
  crossMatchPatchIds,
  parsePatchIdOutput,
} from "./patch-id";
export { analyzeReplayPlan, analyzeRetargetReplay, type ReplayPlanAnalysis } from "./replay-analysis";
