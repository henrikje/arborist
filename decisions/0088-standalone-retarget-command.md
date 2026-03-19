# Standalone retarget command

Date: 2026-03-19

## Context

`arb rebase --retarget` was introduced as a flag for merged-base recovery — when a stacked workspace's base branch has been merged, the flag rebases onto the new base and updates the workspace config. Users couldn't discover it for the more common "change my base branch" use case because it was hidden as a flag on `rebase`. The word "retarget" was established in the codebase and documentation but was not surfaced as a standalone concept.

With the expansion to handle non-merged cases (changing base to an arbitrary branch, not just recovering from a merged base), the operation is no longer a rare recovery step. It answers a fundamentally different question than rebase: "change what my workspace is based on" vs "sync with upstream."

## Options

### Expand --retarget scope on rebase

Keep retarget as a flag on `arb rebase` but broaden it to handle both merged and non-merged cases.

- **Pros:** No new command to learn; single entry point for all rebase-related operations.
- **Cons:** Overloads `rebase` with two distinct workflows. The flag is hard to discover for users who don't think of "change my base" as a rebase operation. Conflict handling and multi-phase workflow make the flag increasingly awkward.

### New `arb retarget` command

Promote retarget to a standalone top-level command.

- **Pros:** Directly discoverable via `arb --help`. Clearly separates "sync with upstream" (rebase) from "change my base" (retarget). Multi-phase workflow with conflict handling earns top-level placement per GUIDELINES.md. Room to grow (e.g. `--where` filtering, verbose plan output) without cluttering rebase.
- **Cons:** One more command in the CLI surface.

### `arb rebase --base` flag

Add a `--base` flag to rebase that changes the target before rebasing.

- **Pros:** Reuses the existing command.
- **Cons:** Conflicts conceptually with the existing `--base` pattern used elsewhere for "use base branch." Still hard to discover. Doesn't address the merged-base recovery flow needing `--onto` semantics.

## Decision

New standalone `arb retarget` command. The `--retarget` flag is removed from `arb rebase`.

## Reasoning

Retarget answers a different question than rebase. Rebase means "incorporate upstream changes into my feature branch" — a routine sync operation. Retarget means "change what my workspace is based on" — a structural change to the workspace itself. Conflating these under one command forces users to think of base-change as a special case of rebasing, which it isn't.

With the expansion to non-merged cases, retarget is no longer a rare recovery operation. It handles both "my base was merged, move to the new base" and "I picked the wrong base, switch to a different one." The multi-phase workflow (fetch, plan, confirm, rebase with `--onto`, update config) has enough complexity to justify top-level placement per GUIDELINES.md's principle that commands earning a plan-confirm-execute cycle deserve their own entry point.

Since `--retarget` was only available in pre-release builds, removing it from `rebase` carries no backwards compatibility burden.

## Consequences

`arb retarget` handles both merged-base and non-merged-base cases. When called without an argument, it retargets to the repo default branch (the common merged-base recovery). When called with a branch name, it retargets to that branch (base-change). `arb branch base` remains the config-only alternative for users who want to change the base without rebasing. Skip messages in `arb rebase`, `arb push`, and `arb pull` are updated to reference `arb retarget` instead of `arb rebase --retarget`. A new `base-change` retarget reason is added alongside the existing `base-merged` reason.
