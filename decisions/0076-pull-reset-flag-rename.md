# Rename `pull --force` to `pull --reset`

Date: 2026-03-14

## Context

`arb pull --force` overrides the `rebased-locally` skip and runs `git reset --hard origin/branch` instead of pulling. The flag name is misleading: in Git, `--force` on fetch/pull means "force-update refs even if not a fast-forward," while in arb it triggers a hard reset — a completely different operation. This violates the GUIDELINES.md principle "commands, flags, and terminology mirror Git wherever possible."

Across all other arb commands, `--force` widens the scope of the same operation (push includes diverged repos, delete includes at-risk workspaces, etc.). `pull --force` is the only case where `--force` replaces the operation entirely — pull becomes reset. The help text itself reveals the mismatch: "Reset to remote tip, overriding rebased-locally skip."

## Options

### Option A: Keep `--force`
Matches arb's internal convention that `--force` means "override a safety check." The rebased-locally skip is a safety check and `--force` overrides it.
- **Pros:** Consistent with arb's other `--force` flags as a safety override. Ergonomic `-f` short form.
- **Cons:** Violates Git mirroring principle. Replaces the operation instead of widening it. Confuses Git-literate users.

### Option B: Rename to `--reset`
Names the flag after the operation it performs (`git reset --hard`). Connects to the existing `arb reset` command and the internal strategy names (`safe-reset`, `forced-reset`).
- **Pros:** Describes the actual operation. Aligns with Git terminology. Pre-release, rename is free.
- **Cons:** Loses `-f` short form (`-r` should stay free for `--rebase`). Slightly breaks the pattern of safety overrides using `--force`.

### Option C: Drop the flag, point to `arb reset`
Remove `--force` entirely and update skip messages to suggest `arb reset` for rebased repos.
- **Pros:** Follows "do one thing" principle strictly. `arb reset` already does exactly this operation.
- **Cons:** Two-step workflow increases friction during a confusing moment. User must identify and name rebased repos manually.

## Decision

Option B — rename to `--reset`.

## Reasoning

`pull --reset` is the only option that both honestly names the operation and preserves the single-pass workflow. The flag selects a strategy (reset instead of merge/rebase), analogous to `--rebase` and `--merge` on the same command. The Git mirroring principle is satisfied: `--reset` describes `git reset --hard`, the actual underlying operation. Option C's "do one thing" argument is valid but outweighed by UX: the rebased-locally scenario is already confusing, and adding a second command with repo args increases friction at a moment when the user wants a simple recovery path.

No short form is assigned — `-r` should remain available for `--rebase` if needed, and `--reset` is a recovery flag, not a daily-use option.

## Consequences

- `arb pull --reset` replaces `arb pull --force`. The `-f` short form is removed.
- `--force` on other commands (push, delete, detach, branch base, template) is unaffected.
- Skip reason text changes from `"pull --force to reset"` to `"pull --reset"`.
- The `forceRebasedSkips` function is renamed to `resetRebasedSkips`.
- Shell completions updated for both bash and zsh.
