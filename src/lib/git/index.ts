export {
  type GitOperation,
  type GitWithTimeoutOptions,
  assertMinimumGitVersion,
  branchExistsLocally,
  branchIsInWorktree,
  checkBranchMatch,
  detectOperation,
  getCommitsBetween,
  getCommitsBetweenFull,
  getDefaultBranch,
  getDiffShortstat,
  getHeadCommitDate,
  getMergeBase,
  getShortHead,
  git,
  gitWithTimeout,
  isLinkedWorktree,
  isRepoDirty,
  isShallowRepo,
  listRemoteBranches,
  networkTimeout,
  parseGitStatus,
  parseGitStatusFiles,
  predictMergeConflict,
  predictStashPopConflict,
  remoteBranchExists,
  validateBranchName,
  validateWorkspaceName,
} from "./git";
export { GitCache, createCommandCache } from "./git-cache";
export {
  type MergeDetectionResult,
  detectBranchMerged,
  findMergeCommitForBranch,
  findTicketReferencedCommit,
  verifySquashRange,
} from "./merge-detection";
export {
  type FileChange,
  type GitVersion,
  parseGitNumstat,
  parseGitVersion,
  parseDiffShortstat,
} from "./parsing";
export {
  type CommitMatchResult,
  type ReplayPlanAnalysis,
  analyzeReplayPlan,
  analyzeRetargetReplay,
  detectRebasedCommits,
  matchDivergedCommits,
  predictRebaseConflictCommits,
} from "./rebase-analysis";
export { type ParsedRemoteUrl, type RemoteProvider, buildPrUrl, parseRemoteUrl } from "./remote-url";
export { type RepoRemotes, getRemoteNames, getRemoteUrl, resolveRemotes, resolveRemotesMap } from "./remotes";
