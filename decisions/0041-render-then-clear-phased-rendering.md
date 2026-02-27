# Render-Then-Clear Phased Rendering

Date: 2026-02-27

## Context

The phased rendering system introduced in decision 0039 renders stale status immediately, then refreshes after fetch completes. The implementation had an ordering bug: `runPhasedRender` cleared the previous phase's output *before* awaiting the next phase's `render()` call. Since `render()` is async (it awaits `gatherFiltered()` and potentially `parallelFetch()`), this produced a blank screen for 1-5 seconds between phases. Additionally, `resolveRemotesMap` ran sequentially before the fetch promise was created, adding 0.5-2s of blocking time before any rendering started.

## Options

### Clear-then-render (original)

Clear the previous phase's output, then await the next phase's render. Simple control flow but produces a visible blank gap.

- **Pros:** Straightforward sequential logic.
- **Cons:** User sees a blank screen while async work runs. Defeats the purpose of phased rendering.

### Render-then-clear

Await the next phase's render while the previous output remains visible, then atomically replace: clear old output and write new output.

- **Pros:** User always sees content on screen. No blank gap between phases.
- **Cons:** None meaningful — the `clearLines`/`countLines` approach handles variable output sizes correctly regardless of ordering.

## Decision

Reorder `runPhasedRender` to render-then-clear: call `await phase.render()` before `clearLines(countLines(prevOutput))`. Additionally, make `resolveRemotesMap` in `status.ts` run concurrently with phase 1 by chaining `parallelFetch` off the remotes promise via `.then()`.

## Reasoning

The entire purpose of phased rendering is to provide immediate feedback. A blank gap between phases undermines this — the user sees the stale table disappear and nothing replace it for several seconds, making the command appear to hang. By moving the async render above the clear, the previous phase's output stays visible throughout the async work, then is atomically replaced. This matches user expectations: content is always visible, and transitions are instantaneous.

The `resolveRemotesMap` concurrency change is safe because it reads canonical repos (`.arb/repos/`) while `gatherFiltered` reads workspace worktrees — no shared mutable state. Chaining via `.then()` lets both operations run in parallel during phase 1.

## Consequences

- The stale table remains visible for the full duration of the fetch, then is atomically replaced with the fresh table. No blank screen gap.
- All three consumers of `runPhasedRender` (`status.ts`, `mutation-flow.ts`, `list.ts`) benefit from the fix without any per-caller changes.
- The `resolveRemotesMap` concurrency reduces time-to-first-render by 0.5-2s for workspaces with many repos.
