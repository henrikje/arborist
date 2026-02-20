# At-Risk Filter and List Redesign

Date: 2026-02-14

## Context

The `arb status` output was information-dense and hard to parse without labels. The `arb list` command showed minimal data (repo count, push status, dirty count) without branch names or the three-tier color scheme. Both commands needed a coherent update: headers for readability, and a filtering model that distinguished "local changes" from the broader category of "needs attention."

The existing `--dirty` filter caught repos with local working tree changes (staged, modified, untracked, conflicts), but several important conditions fell outside its scope: unpushed commits with a clean tree, never-pushed branches, drifted branches, detached HEAD, in-progress operations, and fallen-back base branches.

## Options

### Add `--wide` option to toggle column visibility
Show a compact default view and let users expand columns with `--wide`.
- **Pros:** Users control information density.
- **Cons:** Creates surprise — users may not realize information is withheld. Headers solve the readability problem directly without hiding data. The three-tier color scheme already makes clean rows visually quiet. `--dirty` already serves the "reduce noise" use case by filtering rows. No other arborist command uses a `--wide` pattern.

### Broaden `--dirty` to include all at-risk conditions
Expand what `--dirty` means to cover unpushed, drifted, detached, etc.
- **Pros:** No new flag to learn.
- **Cons:** Changes existing behavior — users who use `--dirty` to mean "what do I need to commit?" would now see unrelated repos. Overloads a specific term with a vague meaning.

### Add `--at-risk` as a separate filter alongside `--dirty`
Two independent filters: `--dirty` = "show repos with local changes" (need to commit/stage), `--at-risk` = "show repos with yellow names" (anything that could get lost or needs attention).
- **Pros:** Each flag answers a clear question. `--dirty` keeps its precise meaning. `--at-risk` reuses the existing `isAtRisk()` function. The two are independent and composable (though in practice `--at-risk` is a superset of `--dirty`). Applied only to `status`, not to `exec`/`open` where "dirty" is the right filter for working tree operations.
- **Cons:** Two flags with overlapping coverage. Users must learn the distinction.

### List redesign: per-repo status detail vs combined summary column
For the `arb list` redesign, show per-repo issue breakdown vs a combined workspace-level summary.
- **Pros of combined summary:** Concise single-column status (`1 dirty, 2 unpushed`). Consistent with workspace-level view. Even "ok" rows stay quiet (all dim).
- **Cons of combined summary:** Loses individual repo names. But `arb status` already provides per-repo detail.

## Decision

Add dim UPPERCASE column headers to both `arb status` and `arb list`. Add `--at-risk` (`-r`) as a separate filter on `status` only. Redesign `arb list` with branch, conditional base, repo count, and combined status columns.

## Reasoning

Headers solve the readability problem without hiding information — `--wide` adds complexity for a problem that doesn't exist once headers are present. The three-tier color scheme already makes clean rows visually quiet, so reducing visual noise is about color treatment, not column hiding.

The `--dirty` / `--at-risk` separation keeps each flag answering one clear question. A comparison of 9 status conditions showed the gap clearly: unpushed commits (clean tree), never-pushed branches, drifted branches, detached HEAD, in-progress operations, fallen-back bases, and upstream mismatches are all "at-risk" but not "dirty." Broadening `--dirty` would break its existing precise semantics.

The list redesign with a combined status column and conditional base column (only shown when any workspace is stacked) keeps the output tight in the common case while surfacing stacking information when relevant.

## Consequences

`arb status` and `arb list` share the same header style (dim UPPERCASE on stdout). The `--at-risk` filter is available on `status` but not on `exec`/`open`, which operate on working trees where "dirty" is the right scope. The list redesign shows workspace-level summaries; per-repo detail remains in `arb status`. The base column appears conditionally, avoiding visual noise for non-stacking users.
