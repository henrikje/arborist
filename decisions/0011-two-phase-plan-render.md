# Two-Phase Plan Render

Date: 2026-02-18

## Context

State-changing commands (`push`, `pull`, `rebase`, `merge`) blocked on `parallelFetch()` for 1-3 seconds, showing only "Fetching N repos..." before rendering the plan. The user saw nothing useful during this time. Since remote tracking refs exist locally (just stale), it was possible to assess and render immediately using stale data, then update with fresh data after the fetch completes.

The question was whether to show stale data immediately or wait for accurate data.

## Options

### Single-phase render (status quo)
Block on fetch, then assess and render once with fresh data.
- **Pros:** Simple. Always shows accurate data. No visual flicker.
- **Cons:** 1-3 second blank wait before any plan output. User has no feedback about what will happen during the most critical decision point (the confirmation prompt).

### Two-phase render
Start fetch in background, render plan immediately from stale refs, then re-render with fresh data when fetch completes.
- **Pros:** Instant feedback. User can start reading the plan immediately. Plan usually doesn't change (stale data is often still accurate). When it does change, the user sees the correction before confirming.
- **Cons:** Visual complexity — plan may redraw. Implementation requires `clearLines()` ANSI control and separate plan formatting functions. Non-TTY must fall back to single-phase.

## Decision

Two-phase render for TTY mode when fetch is enabled. Single-phase fallback for non-TTY, `--no-fetch`, or no repos to fetch.

## Reasoning

The perceived latency improvement is significant — users see the plan instantly instead of staring at a fetch spinner. In practice, the stale plan is correct most of the time (remote refs rarely change between fetches), so the second render is usually a no-op visually. When it does differ, the user sees the correction before they're asked to confirm, so accuracy is never sacrificed.

The TTY guard ensures non-interactive contexts (pipes, CI) get the simple single-render path. The implementation cost is moderate (extract plan formatting into functions, add `clearLines` utility) but pays off for every mutation command interaction.

## Consequences

All four mutation commands (`push`, `pull`, `rebase`, `merge`) show plans instantly in TTY mode. Plan formatting logic is extracted into reusable functions (e.g., `formatPushPlan`, `formatIntegratePlan`). The `clearLines` and `countLines` utilities in `output.ts` are available for future use. The "Fetching..." indicator appears as a dim line below the plan, maintaining visibility of the background operation.
