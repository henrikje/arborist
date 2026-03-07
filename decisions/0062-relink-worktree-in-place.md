# Re-link worktree in place when directory has files

Date: 2026-03-07

## Context

When a workspace repo has a stale or missing `.git` worktree reference (typically from shared-entry corruption), `detectSharedWorktreeEntries()` auto-removes the stale `.git` file and tells the user to run `arb attach <repo>`. However, `addWorktrees()` refuses to re-attach because the directory still contains source files — the user is stuck in a loop where the suggested fix doesn't work. The safety gate was originally added to prevent data loss from blindly recreating a worktree over user files, but the current behavior makes recovery impossible without manual intervention.

## Options

### Refuse and require manual cleanup (status quo)

Error with "remove it manually or back up your changes first" when the directory has files.

- **Pros:** Zero risk of data loss; explicit user control.
- **Cons:** Blocks recovery entirely; the suggested `arb attach` command doesn't work; users must understand git worktree internals to recover manually.

### Re-link worktree in place via temp worktree transplant

Create the worktree at a temporary path with `--no-checkout` (entry only, no file I/O), then transplant the `.git` file to the real directory and fix the back-reference. User files are untouched — any differences from the branch tip appear as uncommitted changes.

- **Pros:** Recovery works automatically; preserves all user files; uses standard `git worktree add` for entry creation (no manual git plumbing); `--no-checkout` avoids wasted I/O since the temp directory is immediately discarded.
- **Cons:** Slightly more complex than a simple recreate; index reflects a clean checkout so all file differences show as unstaged changes.

### Remove directory and recreate from scratch

Delete the directory contents and run `git worktree add` normally.

- **Pros:** Simple implementation; clean worktree state.
- **Cons:** Destroys uncommitted user work — violates the safety principle the original gate was designed to uphold.

## Decision

Re-link worktree in place via temp worktree transplant: create the worktree entry at a temporary path with `--no-checkout`, transplant the `.git` reference file to the real directory, and remove the temp directory.

## Reasoning

The transplant approach preserves the original safety intent (never destroy user files) while making recovery actually work. The `arb attach` suggestion in the auto-repair message becomes truthful instead of a dead end. The index mismatch (clean checkout index vs. user's modified files) is the correct behavior — it surfaces all differences as unstaged changes, which is exactly what `git status` should show.

The write ordering (update back-reference first, then write `.git` to real path) ensures that if the process is interrupted, the temp worktree remains functional and can be cleaned up. Leftover temp directories from interrupted operations are cleaned up at the start of the next re-link attempt.

## Consequences

- `arb attach` now succeeds for repos whose directories have files but stale/missing `.git` references, covering the common post-auto-repair scenario.
- Users will see "re-linking stale worktree in place" instead of the previous error, and their files are preserved as uncommitted changes.
- The `.__arb_relink__` temp directory suffix is reserved — repos with this suffix in their name would conflict (extremely unlikely in practice).
- If the branch has diverged significantly from the user's files, `git status` may show extensive changes. This is correct but could be surprising.
