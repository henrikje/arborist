# Watch Mode Terminal Height Awareness

Date: 2026-03-18

## Context

`arb status --watch` renders onto an alternate screen buffer, which does not scroll. When verbose mode (`-v`) is active and repos have many commits or local file changes, the output easily exceeds the terminal height. Content below the fold is invisible — the user has no way to see it. This is particularly problematic because watch mode is designed for continuous monitoring, often in a split terminal with limited vertical space.

The rendering pipeline already uses a declarative `OutputNode[]` model (built by `buildStatusView()`, rendered by `render()`). Verbose detail is represented as `SectionNode` items attached to table rows via `afterRow`. The watch loop already handles `SIGWINCH` (terminal resize) by re-rendering.

## Options

### A: String-level truncation
After rendering to a string, count lines and truncate if the output exceeds terminal height.
- **Pros:** Simple to implement, no structural changes.
- **Cons:** Loses semantic context — can't insert properly styled "… and N more" indicators. Would need to inject raw ANSI into an already-rendered string. Fragile with multi-line nodes.

### B: OutputNode-level truncation with uniform cap
Before rendering, walk the node tree and truncate `SectionNode` items using a uniform cap (maximum items any section can display). Apply between `buildStatusView()` and `render()`.
- **Pros:** Preserves the declarative model. Uses the same `cell()` primitives for overflow indicators, matching existing "... and N more" patterns. Naturally handles SIGWINCH via re-render. Clean separation — `render()` stays pure, truncation is a pre-processing step.
- **Cons:** Requires a line-counting pass over the node tree. The uniform cap means a section with 3 items and one with 30 items get the same cap, which could show fewer items than necessary for the small section. In practice this is rare and the visual consistency is worth it.

### C: Data-level truncation
Limit the number of commits/files gathered by `gatherVerboseDetail()` based on terminal height.
- **Pros:** Less data processing.
- **Cons:** Requires threading terminal height through the data layer, mixing presentation concerns into the status model. The data layer shouldn't know about the terminal. Also doesn't account for the aggregate height across multiple repos — each repo's budget depends on what other repos contribute.

## Decision

Option B: OutputNode-level truncation with a uniform cap, applied in watch mode only.

## Reasoning

Option B aligns with the existing architecture: the render pipeline is already split into node construction → rendering, and this inserts a transformation step between them. The uniform cap approach is simpler than proportional distribution and produces visually consistent output — every verbose section shows at most N items, which is easy for users to understand. The "... and N more" indicator uses the same `cell(..., "muted")` pattern already established in `verboseCommitsToNodes()`.

Non-watch output goes to stdout which scrolls naturally, so height awareness is only needed for the alternate-screen watch mode. This keeps the scope focused and avoids impacting the regular `arb status` code path.

## Consequences

Watch mode now adapts to terminal height. Sections show as many items as space allows, with a floor of 1 item + "... and N more" per section. Terminal resizes are handled automatically.

The implementation lives in a single new file (`render/height-fit.ts`) with no changes to the existing render pipeline. If proportional distribution is ever needed (different caps per section), the `fitToHeight()` function can be extended without changing its callers.

Non-verbose watch mode (table-only) does not benefit — if a workspace has more repos than terminal rows, the table overflows. This could be addressed separately with a different mechanism (repo pagination or summary rows).
