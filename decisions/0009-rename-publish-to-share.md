# Rename Publish to Share for Remote Role Terminology

Date: 2026-02-18

## Context

Arborist tracks two independent relationships per repo: integration (how far the feature branch has drifted from the base branch) and sharing (whether the local feature branch is in sync with the same branch on a remote). The integration axis was consistently named (`upstream` for the remote role, `base` for everything user-facing), but the sharing axis used "publish" internally and "REMOTE" in the UI — both problematic. "Publish" carries a one-time distribution connotation, and "REMOTE" is too generic since both axes involve remotes.

## Options

### `publish` (status quo)
- **Pros:** Already used in ~135 places. Distinct from generic "remote."
- **Cons:** One-time connotation. VS Code uses "Publish" only for initial push. PUBLISH (7 chars) doesn't match BASE (4) visually.

### `share`
- **Pros:** Maps to collaborative intent ("is this shared?"). Short (5 chars, close to BASE's 4). Describes ongoing relationship accurately. Self-explanatory.
- **Cons:** Not a standard git term. Slightly unusual as noun modifier.

### `remote`
- **Pros:** Universally understood. Short.
- **Cons:** Ambiguous — both remotes are "remote." The integration axis also uses a remote. Doesn't tell you *which* remote. This was the root problem with the REMOTE column header.

### `tracking`
- **Pros:** Git-precise (compares against tracking branch).
- **Cons:** Git's `@{upstream}` tracking concept refers to the push/pull target, while arborist's `upstream` means the rebase/merge target. Adds a third meaning layer.

### `sync`
- **Pros:** Describes the action well.
- **Cons:** Applies to both axes equally (rebase is also syncing). Ambiguous.

### `origin` / `fork`
- **Pros:** Describe specific remote setups.
- **Cons:** Not role names. Meaningless in single-remote setups.

## Decision

Rename `publish` to `share` across the entire codebase: `RepoRemotes.share`, `RepoStatus.share`, column header `SHARE`, filter `behind-share`, flag label `behind share`.

## Reasoning

`share` has the strongest conceptual fit: it describes an ongoing collaborative relationship, not a one-time publication event. The column symmetry with BASE (5 vs 4 chars) is nearly ideal. The two-axis model becomes clean and parallel: BASE/SHARE for user-facing, upstream/share for remote roles, behind-base/behind-share for filters.

The rename touched ~135 occurrences across 12 source files, but was mechanical and there were no backwards compatibility constraints (pre-1.0 tool).

## Consequences

The two-axis terminology is now consistent at every layer: remote role (`upstream`/`share`), status section (`base`/`share`), column header (`BASE`/`SHARE`), filter flag (`behind-base`/`behind-share`). Documentation uses "integration axis" and "sharing axis" to describe the two relationships. The renamed terminology was added to GUIDELINES.md under "Canonical status model" so future code follows the convention.
