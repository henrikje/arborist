# Branch Divergence Graph for Synchronization Plans

Date: 2026-02-27

## Context

`arb rebase` and `arb merge` show a text plan with ahead/behind counts and conflict predictions. With `--verbose`, incoming commits are listed. But there is no way to visualize the topology — where the branches diverged, what commits are on each side, and what the operation will actually do to the commit graph.

We needed to decide how to surface this topology information: by extending the existing `--verbose` flag or by adding a new `--graph` flag.

## Options

### Option A: Enhance `--verbose` with inline branch diagram

Add the graph as part of the existing `--verbose` output. No new flag.

- **Pros:** No new flag to learn.
- **Cons:** Conflates two concerns (commit detail vs. topology). Users who want one without the other can't get it. Changes the established meaning of `--verbose`. Violates the "do one thing" principle — `--verbose` currently means "show commit subjects", not "show topology".

### Option B: New `--graph` flag with compact vertical divergence diagram

Add a new `-g, --graph` flag that renders a single-column vertical diagram per repo. Orthogonal to `--verbose` — can be combined for full detail.

- **Pros:** Clean separation of concerns. Composable (`--graph`, `--verbose`, or both). Simple single-column layout works at any terminal width. Minimal new git data needed (just merge-base hash + optionally outgoing commits). Supports retarget with a distinct visual (`--x--` cut point, `:` connector).
- **Cons:** New flag to learn. Adds visual weight to multi-repo plans.

### Why not reuse an existing graph library?

`git log --graph` renders a full commit DAG, not a schematic. npm graph libraries add dependency weight for ~50 lines of formatting code. All existing formatting in arborist is hand-rolled — a dependency would be inconsistent.

## Decision

Option B: new `--graph` flag with retarget support.

## Reasoning

Option B follows the GUIDELINES.md principle that each command/flag should have a clear, single purpose. The orthogonal-flags pattern (like `--verbose` and `--json` being separate) is already established in the codebase. `--graph` shows topology; `--verbose` shows commit subjects. They compose naturally: `--graph --verbose` embeds commit subjects inline in the diagram.

The single-column vertical layout avoids terminal width issues and is simple to implement as a pure formatting function.

## Consequences

- Users can independently choose topology (`--graph`) and commit detail (`--verbose`), or combine both.
- When both `--graph` and `--verbose` are active, the separate "Incoming from..." section is suppressed since the graph subsumes it.
- The graph renderer is a pure function in its own module (`integrate-graph.ts`), keeping the formatting concern isolated from data gathering.
- Future enhancements (e.g. color-coding conflict-predicted repos in the graph) can be added to the renderer without touching the data flow.
