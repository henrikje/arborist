# Extract Command — Retroactive Workspace Splitting

Date: 2026-03-28

## Context

Real work doesn't decompose cleanly upfront. Users discover that a single branch should have been multiple PRs after committing — infrastructure before feature, post-merge continuation, accidental feature bleed. The one-workspace-one-branch invariant means this requires restructuring history across repos.

The question: should Arborist treat mistaken branch structure as a first-class orchestration problem? And if so, how — as an authoring tool or a coordination tool?

## Options

### Single command with directional flags

One command that handles both prefix extraction (infrastructure into lower workspace) and suffix extraction (continuation into upper workspace). Direction is determined by the flag: `--ending-with` for prefix, `--starting-with` for suffix, `--after-merge` for auto-detected post-merge continuation.

- **Pros:** One verb to learn. Direction and boundary inclusion encoded in the flag name. `--ending-with` and `--starting-with` are unambiguous about which commits are extracted.
- **Cons:** Longer flag names than `--to`/`--from`. Acceptable for a rare, high-stakes command.

### Two separate verbs (`arb split` + `arb cut`)

Two commands with names that imply direction. "Split" for prefix (split off the foundation), "cut" for suffix (cut off the tip).

- **Pros:** Each verb has its own identity. No flags needed for direction.
- **Cons:** Two commands to learn. With `--at`, the boundary inclusion is less clear than with directional prepositions.

### Skill-level solution (no Arborist changes)

Handle this entirely in a Claude skill. The skill uses git primitives directly for cherry-picking and branch creation.

- **Pros:** Zero changes to Arborist core.
- **Cons:** No conflict prediction, no operation record, no `--continue`/`--abort`, no multi-repo atomicity. These are the core coordination values Arborist provides.

## Decision

Single command `arb extract` with `--ending-with`/`--starting-with`/`--after-merge` directional flags. Both directions share implementation (like `arb rebase` and `arb merge` share `integrate.ts`). The plan visualization is the safety net for boundary clarity.

## Reasoning

Restructuring existing commits is coordination, not authoring, as long as no new content is created. Rebase moves commits — Arborist already does this. Extract moves commits between branches — same operation, different topology. The creative decisions (where to split, what to name the workspace) are the user's. Arborist handles multi-repo coordination, atomicity, conflict prediction, and recovery.

The single-command approach was chosen over two verbs because the operations share 90% of their logic (state capture, branch creation, workspace creation, plan formatting, operation records). The directional flags (`--ending-with`/`--starting-with`) make boundary inclusion unambiguous. The plan visualization confirms exactly which commits go where.

The `--after-merge` mode addresses the most common suffix case (post-merge continuation) without requiring the user to manually identify the merge boundary.

## Consequences

- `arb extract` joins the synchronization command group alongside rebase, merge, retarget, reset.
- The operation record supports `--continue`/`--abort`/`arb undo`, making extract as recoverable as other mutation commands.
- Local branch base resolution (DR-0098) is a prerequisite — freshly-extracted workspaces resolve their base against local refs immediately.
- The `[<repo>:]<commit-ish>` syntax for split points is new to Arborist and may be extended to other commands.
- Interactive split-point selection, `--graph` visualization, and conflict prediction are deferred as future improvements.
- The `arb push` hint for `merged-new-work` now suggests `arb extract --from-merge` as an alternative to rebase.
