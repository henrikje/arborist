export interface ChainWalkResult {
  /** The resolved target branch, or null to fall back to default branch resolution. */
  targetBranch: string | null;
  /** Merged branch names traversed, in order. */
  walkedPath: string[];
  /** Whether the chain walk changed the target from what it would have been. */
  didWalk: boolean;
}

export interface ChainWalkDeps {
  /** Read a workspace's configured base branch. Returns null if workspace or base doesn't exist. */
  readWorkspaceBase: (workspaceName: string) => string | null;
  /** Check if a branch is merged into the default branch. */
  isBranchMerged: (branchName: string) => Promise<boolean>;
  /** Find the workspace name whose branch field matches. Returns null if none. */
  findWorkspaceForBranch: (branchName: string) => string | null;
}

const NO_WALK: ChainWalkResult = { targetBranch: null, walkedPath: [], didWalk: false };

/**
 * Walk the stack chain to find the nearest non-merged ancestor when a base is merged.
 *
 * For `main <- a <- b <- c`, if b is merged: read b's workspace config → find b's base
 * is a → check if a is merged → if not, return a as the target.
 */
export async function walkRetargetChain(
  initialBranch: string,
  sourceWorkspace: string | undefined,
  deps: ChainWalkDeps,
  maxDepth = 10,
): Promise<ChainWalkResult> {
  if (!sourceWorkspace) return NO_WALK;

  const visited = new Set<string>();
  const walkedPath: string[] = [];
  let currentBranch = initialBranch;
  let currentWorkspace: string | undefined = sourceWorkspace;

  for (let i = 0; i < maxDepth; i++) {
    if (!currentWorkspace) break;

    const base = deps.readWorkspaceBase(currentWorkspace);
    if (!base) {
      // Intermediate workspace has no base (targets default branch) — fall through.
      return { targetBranch: null, walkedPath, didWalk: walkedPath.length > 0 };
    }

    // We found a base — record the merged branch we're walking past
    walkedPath.push(currentBranch);
    currentBranch = base;

    if (visited.has(base)) break; // cycle
    visited.add(base);

    const merged = await deps.isBranchMerged(base);
    if (!merged) {
      return { targetBranch: base, walkedPath, didWalk: true };
    }

    // base is also merged — find its workspace and continue
    currentWorkspace = deps.findWorkspaceForBranch(base) ?? undefined;
  }

  // Exhausted depth or broken chain
  return { targetBranch: null, walkedPath, didWalk: walkedPath.length > 0 };
}
