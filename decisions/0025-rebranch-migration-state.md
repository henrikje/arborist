# Rebranch Migration State

Date: 2026-02-22

## Context

Arborist workspace creation defaults the git branch name to the workspace name. Teams with required branch prefixes (e.g. `feat/JIRA-123`) end up on branches that violate their conventions. There was no first-class recovery path: users had to either recreate the workspace or manually run per-repo `git branch -m` and edit `.arbws/config`.

`arb rebranch` closes this gap. The key design challenge is that `git branch -m` is non-atomic across repos — a partial failure leaves the workspace inconsistent. The question was how to handle this safely, and what level of automation to provide for remote branches.

## Options

### No migration state (simple rename)
Rename branches sequentially with no recovery state. On failure, re-running would hit a "nothing to do" guard (config already updated, old branch gone in successful repos, new branch not yet present in failed repos — but old branch still present in those).
- **Pros:** Simple. No new config keys.
- **Cons:** Re-running after partial failure leaves the workspace in an ambiguous state. The command would try to rename repos where the old branch still exists (correct) but also silently pass on repos where the old branch is gone but the new branch doesn't exist (silent data loss / confusion).

### Migration state only (no continue/abort)
Write `rebranch_from = <old-branch>` to config before git ops. On success, clear it. On failure, leave it. Re-running `rebranch <new>` reads the migration key and resumes.
- **Pros:** Enables safe re-run/resume. Clear intent preserved.
- **Cons:** No explicit `--abort` to cleanly cancel and roll back. Users who want to start fresh must manually edit config.

### Migration state with --continue/--abort (chosen)
Same migration key, plus explicit `--continue` (resume) and `--abort` (rollback) subcommands modeled after git's own in-progress operation pattern.
- **Pros:** Full recovery path. `--abort` rolls back successful renames. Mirrors familiar git UX. Config is honest at all times.
- **Cons:** Adds two subcommands and the associated state machine. Config can transiently hold `rebranch_from`.

## Decision

Migration state with `--continue` and `--abort`, modeled after git's own rebase-in-progress / merge-in-progress pattern.

## Reasoning

`git branch -m` is not atomic across repos. A partial failure is a realistic scenario — network issues, permission errors, or a locked worktree can stop the sequence mid-way. Without migration state, re-running is unsafe: repos already renamed won't be renamed again (old branch gone), repos not yet renamed will be, but the user has no way to know the workspace is now split across two branch names without inspecting each repo manually.

Writing `rebranch_from` to config before git ops makes the intent durable and the state inspectable. Other arb commands (`arb status`, `arb push`) only read `branch`, so they continue to work correctly against the new branch name immediately. Repos not yet renamed appear as drifted — honest, not hidden.

The `--continue`/`--abort` commands mirror git's own recovery model for multi-step operations. Developers who have used `git rebase --continue` will immediately understand the pattern. `--abort` rolls back only local renames (remote operations run only after all local renames succeed, so `--abort` never needs to reverse remote changes).

Pushing the renamed branch to the remote is deliberately left to `arb push` — renaming is `arb rebranch`'s job, publishing is `arb push`'s job. However, `--delete-remote-old` is included as an opt-in convenience because the old remote branch is dead weight after a rename and forgetting to clean it up is a common source of confusion. Deletion is a cleanup action, not a publish action, so it fits within the rename command's scope. It only runs after all local renames succeed, ensuring `--abort` never needs to reverse remote changes.

## Consequences

The `.arbws/config` file can transiently hold a `rebranch_from` key during an in-progress rename. All existing commands that read config only look at `branch` and `base`, so they are unaffected. If another arb command reads an unfamiliar key, it is ignored (the `configGet` function returns `null` for keys not present, and `rebranch_from` is only read by `rebranch` itself). On successful completion `rebranch_from` is always cleared. A new principle follows from this decision: arb commands that can partially complete across multiple repos should carry explicit in-progress state enabling `--continue` and `--abort`, rather than leaving partial state silent.
