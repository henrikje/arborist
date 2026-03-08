# Interactive base branch selection in guided create

Date: 2026-03-08

## Context

The guided `arb create` flow (bare invocation, no args) prompts for workspace name, repos, and branch — but base branch selection requires knowing about the `--base` flag. Decision 0059 made base flag-only to remove repetitive low-value prompts for the common case. However, this means stacking — a key workflow — is invisible to users who haven't read the docs.

The question was how to surface base branch selection in the guided flow without regressing the streamlined experience for users who provide args.

## Options

### Show only workspace branches as base candidates

List branches from existing local workspaces, since those are the user's active work and natural stacking targets. Include a "Enter a custom branch name…" escape hatch for edge cases.

- **Pros:** Short, focused list. Every option is contextually relevant.
- **Cons:** Misses valid stacking targets — a collaborator's remote branch that has no local workspace is invisible.

### Show all remote branches with workspace branches sorted first

Use the same remote branch data already fetched for the branch selector. Annotate branches that correspond to local workspaces. Sort workspace branches to the top. Include "No base" and "Enter a custom branch name…" as fixed options.

- **Pros:** Complete view — any remote branch is selectable as a base. Workspace branches get priority without hiding anything. Reuses existing data (no extra fetch). Consistent with the branch selector pattern.
- **Cons:** List can be long for repos with many branches (mitigated by pageSize and the custom input option near the top).

### Keep base flag-only

Do nothing. Users learn about `--base` through info line hints and documentation.

- **Pros:** No new code. Guided flow stays shorter.
- **Cons:** Stacking remains undiscoverable in the guided flow.

## Decision

Show all remote branches with workspace branches sorted first (option 2). The base selector appears only in the bare guided create flow (`arb create` with no args) and is skipped when `--base` is provided or when there are no remote branches.

## Reasoning

The guided flow exists to surface all workspace configuration options interactively. Excluding the base branch left a gap in discoverability. Using the full remote branch list avoids artificially limiting stacking targets — users may want to stack on a colleague's branch that has no local workspace. Sorting workspace branches first puts the most likely targets within immediate reach.

Placing "Enter a custom branch name…" as the second option (after "No base") ensures users with long branch lists can quickly reach the custom input without scrolling, matching the branch selector's pattern.

The selector reuses branch data already fetched during the branch selection step, so there is no additional network overhead.

## Consequences

- Bare `arb create` now has four interactive steps: workspace name, repos, branch, and base branch.
- The base selector is skipped entirely when there are no remote branches to show, keeping the first-ever workspace creation clean.
- `arb create my-feature` (with a name arg) remains unchanged — no base prompt, just the info line with `--base` hint.
- The `discoveredBranches` array is hoisted from the branch selector scope so it can be reused by the base selector.
