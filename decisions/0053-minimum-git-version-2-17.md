# Minimum Git Version: 2.17

Date: 2026-03-03

## Context

Arborist had no documented minimum Git version — the README just said "requires Git." An audit of all version-critical commands found features spanning Git 1.x through 2.38. The critical question: what is the true floor, and how should the codebase handle features above it?

`arb create` uses `worktree add --no-track` (Git 2.17) to prevent spurious tracking configuration. Without `--no-track`, `branch.autoSetupMerge` can cause git to auto-configure tracking, breaking Arborist's push detection logic (distinguishing "never pushed" from "pushed, merged, remote deleted"). This makes Git 2.17 the hard functional floor — below it, the core use case silently produces wrong behavior.

## Options

### Floor at 2.22 (branch --show-current)

The simplest option: accept the existing `branch --show-current` dependency.
- **Pros:** No code changes needed.
- **Cons:** Excludes users on 2.17–2.21 for no functional reason. `branch --show-current` is trivially replaceable with `symbolic-ref --short HEAD`.

### Floor at 2.17 (worktree add --no-track)

Replace `branch --show-current` with `symbolic-ref --short HEAD`, gate features above 2.17.
- **Pros:** Maximizes compatibility. 2.17 is the true functional floor — the first version where `arb create` can work correctly. Available in Debian oldstable (buster), RHEL 8, and Ubuntu 18.04.
- **Cons:** Requires replacing 6 call sites and adding version checks for 2.30+ and 2.38+ features.

### Floor at 2.30 (worktree repair)

Would cover `branch rename` without gating.
- **Pros:** Simpler — no version checks for rename.
- **Cons:** Excludes 2.17–2.29 users who may never use `branch rename`. Unnecessarily restrictive.

## Decision

Set the minimum at Git 2.17. Replace `branch --show-current` with `symbolic-ref --short HEAD`. Hard-error below 2.17 at the start of every command. Gate features above 2.17 individually: `branch rename` with workspace directory rename errors below 2.30, conflict prediction silently degrades below 2.38.

## Reasoning

The floor should match the lowest version where core functionality (create, delete, status, push, pull, rebase) works correctly. `worktree add --no-track` is not replaceable — its absence causes semantic bugs, not just missing features. Everything else above 2.17 either degrades gracefully or is used by a single non-core command that can be gated.

Replacing `branch --show-current` with `symbolic-ref --short HEAD` is a one-line change per call site with identical behavior in all cases that matter (both return empty/error on detached HEAD, which existing code already handles).

The hard error (via `assertMinimumGitVersion`) follows the "detect, warn, and protect" principle — a version check at startup is far better than a cryptic `error: unknown option '--no-track'` during `arb create`.

## Consequences

- Every command that creates a `GitCache` calls `assertMinimumGitVersion(cache)`. The version is cached, so the check is free after the first call.
- New git features above 2.17 must be version-gated and documented in ARCHITECTURE.md.
- `branch rename` refuses workspace directory renames below 2.30 but allows branch-only renames with `--keep-workspace-name`.
- Conflict prediction (`merge-tree --write-tree`) continues to silently return null below 2.38.
- The version ladder is documented in ARCHITECTURE.md, making it easy to audit when considering new git features.
