# Branch model flexibility analysis

Date: 2026-03-19

## Context

During complex multi-repo development, users sometimes want more fine-grained branch control than the workspace model provides. Three scenarios prompted this analysis:

1. A performance optimization done while developing a feature should be published separately on a different branch — but the workspace has one shared branch for all repos.
2. A stacked workspace where most repos target a non-default base branch, but one repo should target a different base — but the workspace has one configured base branch.
3. A workspace should stack on another workspace's branch that hasn't been pushed yet — but base branches are resolved against remote refs only.

The question: should Arborist relax its single-branch model to handle these cases, or are the restrictions focused and intentional?

## Options

### Per-repo share branch

Allow individual repos to be on different feature branches within one workspace.

- **Pros:** A user could split out a commit to a separate branch without leaving the workspace.
- **Cons:** Breaks the foundational identity invariant. Wrong-branch detection becomes meaningless. Every sync command (`push`, `pull`, `rebase`, `merge`, `retarget`) assumes a single branch. `addWorktrees()` creates all worktrees on the same branch. Per-repo branches create a new class of git worktree conflicts. The use case is an authoring concern (DR-0023) better served by a separate workspace and cherry-pick.

### Per-repo base branch

Allow individual repos to override the workspace-level base branch via config (e.g. `repoBase?: Record<string, string>`).

- **Pros:** Explicit control over which base each repo targets. Handles the edge case where a workspace spans repos from different feature stacks.
- **Cons:** Breaks the all-or-nothing retarget model (DR-0017, DR-0088). The `maybeWriteRetargetConfig()` consensus logic would need per-repo tracking. Config schema grows from `{ branch, base? }` to include a repo-override map. The `arb branch base` command would need `--repo` flag and per-repo display.

### Local-only base branch

Resolve base branches against local refs when they don't exist on the remote, enabling stacking on unpublished work.

- **Pros:** Natural workflow for stacking before pushing. The data model already accommodates it (`RepoStatus.base.remote` is typed `string | null`). The code change is bounded.
- **Cons:** Violates the fetch contract — local branch refs change implicitly when the other workspace commits, breaking the visibility principle. Rebases onto the other workspace's possibly-incomplete commits. The stacked base merge detection and classify-integrate skip logic assume remote refs.

### Do nothing

Keep the current model. Document recommended workflows for the edge cases.

- **Pros:** No new complexity. Each scenario has an existing workflow. The branch model remains simple and predictable.
- **Cons:** The "push first" requirement for stacking is a minor friction point.

## Decision

Do nothing. The current branch model is the sweet spot.

## Reasoning

**Per-repo share branch** is the most load-bearing restriction in the system. The one-branch invariant is what makes Arborist a coordination tool rather than a multi-repo exec wrapper. `workspaceBranch()` reads `config.branch` as the workspace's identity. `computeFlags()` uses it for wrong-branch detection. Every sync command receives one branch and checks all repos against it. Worktree creation assumes a single branch. Breaking this invariant would require a ground-up redesign of every command. The proposed use case — splitting a commit to a different branch — is an authoring concern that belongs in a separate workspace, per the authoring boundary (DR-0023).

**Per-repo base branch** is already gracefully handled without explicit support. When `gatherRepoStatus()` resolves the workspace's configured base against each repo's remote, repos that lack the branch silently fall back to their own default branch. The `configuredRef` field and `isBaseMissing` flag make this visible — verbose mode shows "Configured base branch X not found on {remote}" with guidance. This implicit per-repo flexibility is the sweet spot: strict workspace-level config with graceful per-repo fallback. Formalizing per-repo base overrides would complicate the retarget model (DR-0017, DR-0088), the config schema, and the branch-base command UI for marginal benefit over the existing fallback.

**Local-only base branches** violate the fetch contract. Arborist's visibility principle requires that state changes happen through explicit action. Remote refs change only when the user fetches — the user controls when their view of the world updates. Local branch refs change implicitly whenever the other workspace commits, because git worktrees share the ref store. A base branch that moves silently — without fetch, without any action by the user in workspace B — is a visibility violation. The user would see different ahead/behind counts each time they run `arb status`, without having done anything themselves. The alternative is simpler and preserves the contract: `arb push` in the base workspace makes the branch available on the remote. This is one command and aligns with the principle that Arborist coordinates published state.

## Consequences

The branch model remains: one shared branch per workspace (required), one base branch per workspace (optional, with per-repo fallback to defaults). Base branches are resolved against remote refs only.

Recommended workflows for the analyzed scenarios:

- **Split a commit to a separate branch**: Create a separate workspace for the split-out work. Cherry-pick or re-commit the relevant changes there. This respects the authoring boundary.
- **Per-repo base differences**: Let the fallback mechanism handle it. When a repo lacks the configured base on its remote, it silently uses its own default branch. The `isBaseMissing` flag makes this visible.
- **Stacking on unpublished work**: Push the base workspace's branch first (`arb push` in the base workspace), then create the stacked workspace. If the work isn't ready for review, push it as a draft/WIP branch.

These workflows are already possible today. The invariant is codified in GUIDELINES.md under "One workspace, one branch."
