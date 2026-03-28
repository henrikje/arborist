export type SkipFlag =
  // Common across commands
  | "detached-head"
  | "wrong-branch"
  | "base-merged-into-default"
  | "already-merged"
  | "merged-new-work"
  | "fetch-failed"
  | "dirty"
  | "operation-in-progress"
  // Push-specific
  | "no-commits"
  | "behind-remote"
  | "diverged"
  // Pull-specific
  | "no-share"
  | "remote-gone"
  | "rebased-locally"
  // Integrate-specific
  | "no-base-branch"
  | "no-base-remote"
  | "retarget-target-not-found"
  | "retarget-base-not-found"
  | "retarget-no-default"
  | "retarget-same-base"
  // Extract-specific
  | "extract-target-exists"
  | "below-merge-point";

export const BENIGN_SKIPS: ReadonlySet<SkipFlag> = new Set([
  "already-merged",
  "no-commits",
  "no-share",
  "no-base-branch",
]);

export const RETARGET_EXEMPT_SKIPS: ReadonlySet<SkipFlag> = new Set(["no-base-branch", "retarget-target-not-found"]);

export const EXTRACT_EXEMPT_SKIPS: ReadonlySet<SkipFlag> = new Set(["no-base-branch"]);
