# Smart Retarget for Deep Stacks

Date: 2026-03-28

## Context

When workspace C stacks on workspace B which stacks on workspace A (`main <- a <- b <- c`), and B gets merged into `main`, running `arb retarget` in C falls back to the repo's default branch (`main`). In a deep stack, the correct target is A — the next non-merged ancestor in the stack chain. Without chain walking, the user must manually specify `arb retarget feat/a`, which requires knowing the stack topology.

The "local branches as base" feature (DR-0098) added `sourceWorkspace` to the status model, identifying which workspace has the base branch checked out. This enables reading the base workspace's config to discover the chain.

## Options

### A: Per-repo chain walking in the classifier

Each repo independently resolves the chain-walked target during `assessRetargetRepo`. The classifier reads workspace configs and runs merge detection.

- **Pros:** Self-contained per repo; no shared state.
- **Cons:** Workspace configs are a workspace-level concern, not per-repo. The classifier has no access to `arbRootDir` or workspace listing. Duplicates merge detection across repos. Breaks the classifier's design contract (classifiers operate on `RepoStatus`, not workspace configs).

### B: Command-layer chain walking before per-repo classification

The command layer resolves the chain-walked target once, then passes it to the classifier as a pre-resolved `targetBranch`. Uses a single representative repo for merge detection.

- **Pros:** Clean separation — workspace-level concern handled at workspace level. Single merge detection pass. Classifier's existing `targetBranch` parameter handles the result naturally.
- **Cons:** Uses one representative repo for merge detection; if repos have fundamentally different remote structures, the representative may not reflect all repos. Per-repo classifier catches this via `retarget-target-not-found` skip (non-blocking).

### C: Chain walking inside `postAssess` after initial assessment

After the first round of assessment reveals all repos targeting default (merged base), intercept with chain walking and re-assess with the new target.

- **Pros:** No changes to fetch timing; assessment already has fresh refs.
- **Cons:** Double assessment. `postAssess` can't trigger re-assessment easily. Complex control flow.

## Decision

Option B: command-layer chain walking before per-repo classification. Fetch manually before chain walking (`shouldFetch: false` to `runPlanFlow`), ensuring fresh refs for merge detection.

## Reasoning

The chain walk is a workspace-level concern — it reads workspace configs, which are workspace-scoped. Placing it in the command layer matches the existing pattern where workspace-level decisions (config updates, target resolution) live in the command, while per-repo decisions live in the classifier.

Manual fetch before chain walking ensures accurate merge detection. This trades phased render (the optimization showing a pre-fetch plan that updates post-fetch) for correctness. Retarget is an infrequent operation, making the trade-off acceptable.

The dependency-injected `walkRetargetChain` function isolates the algorithm from git and filesystem dependencies, enabling thorough unit testing without spawning processes.

## Consequences

- `arb retarget` without arguments automatically follows the stack chain when the base is merged, finding the nearest non-merged ancestor. Users no longer need to know the exact stack topology.
- Chain walking requires workspace configs to exist for intermediate branches. Deleted workspaces break the chain, falling back to default branch resolution (same as current behavior).
- Layered squash merges (where each level was independently squash-merged) may not be detected by the current merge detection (cumulative patch-id doesn't match). Regular merges and single-level squash merges work correctly. This is an existing merge detection limitation, not introduced by chain walking.
- Retarget loses phased render when chain walking is possible (`targetBranch === null && configBase` path). Non-stacked workspaces and explicit targets are unaffected.
