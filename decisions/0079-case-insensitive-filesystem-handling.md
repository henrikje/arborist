# Case-Insensitive Filesystem Handling

Date: 2026-03-16

## Context

macOS uses case-insensitive APFS by default. This causes invisible collisions for a git worktree manager: workspace directories `My-Feature` and `my-feature` resolve to the same path, git refs `refs/heads/Feature` and `refs/heads/feature` are the same loose file, and `git branch -m my-feature My-Feature` fails with "already exists". Git itself detects and adapts to this via `core.ignorecase`, set automatically during `git init`/`git clone`. Arborist had no equivalent handling, leading to silent corruption (two worktrees on the same branch), blocked operations (case-only renames), and confusing error messages.

## Options

### Adapt per platform (align with git)
Arb is case-preserving. On case-insensitive FS (detected via `core.ignorecase`), detect collisions and give clear errors. On case-sensitive FS, allow full capabilities — `Feature` and `feature` are legitimately different branches on Linux.
- **Pros:** Matches git's own approach, no capability regression on Linux, platform-appropriate behavior
- **Cons:** Platform-conditional code paths, tests need `.skipIf()` for platform

### Case-insensitive everywhere
Normalize all workspace/branch comparisons to lowercase on all platforms.
- **Pros:** Simpler mental model, consistent cross-platform behavior
- **Cons:** Restricts Linux users unnecessarily, diverges from git's approach

## Decision

Adapt per platform, aligning with git's `core.ignorecase` detection.

## Reasoning

GUIDELINES.md states "Align with Git and good CLI practice" — git is case-preserving and adapts per platform, so arb should too. Enforcing case-insensitivity everywhere would violate "safe and simple parallel multi-repo development" by restricting valid workflows on case-sensitive filesystems where case-variant branches are legitimate.

The `isCaseInsensitiveFS()` utility reads `core.ignorecase` from a repo, reusing git's own FS detection rather than inventing a separate probe. The `renameBranch()` utility handles case-only renames via a two-step rename through a temp branch — this works around a git limitation on case-insensitive FS and is harmless on case-sensitive FS.

## Consequences

- `isCaseInsensitiveFS()` is available in `src/lib/git/git.ts` for any future code that needs platform-adaptive behavior.
- `renameBranch()` replaces direct `git branch -m` calls in both rename flows, handling case-only renames transparently.
- Case-variant branch collisions are blocked on case-insensitive FS but allowed on case-sensitive FS.
- Integration tests use `describe.skipIf(isCaseSensitiveFS)` for platform-specific behavior; both platforms have dedicated tests.
- If git's reftable backend adds worktree support (making refs always case-sensitive), the `isCaseInsensitiveFS` guard in `worktrees.ts` would become unnecessary but not harmful.
