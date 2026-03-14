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
  | "not-pushed"
  | "remote-gone"
  | "rebased-locally"
  // Integrate-specific
  | "no-base-branch"
  | "no-base-remote"
  | "retarget-target-not-found"
  | "retarget-base-not-found"
  | "retarget-no-default";

export const BENIGN_SKIPS: ReadonlySet<SkipFlag> = new Set([
  "already-merged",
  "no-commits",
  "not-pushed",
  "no-base-branch",
]);

export const RETARGET_EXEMPT_SKIPS: ReadonlySet<SkipFlag> = new Set(["no-base-branch", "retarget-target-not-found"]);
