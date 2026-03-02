export type SkipFlag =
	// Common across commands
	| "detached-head"
	| "drifted"
	| "base-merged-into-default"
	| "already-merged"
	| "merged-new-work"
	| "fetch-failed"
	| "dirty"
	// Push-specific
	| "no-commits"
	| "behind-remote"
	| "diverged"
	// Pull-specific
	| "not-pushed"
	| "remote-gone"
	| "rebased-locally"
	// Integrate-specific
	| "operation-in-progress"
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
