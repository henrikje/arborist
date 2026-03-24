# Leading-Edge Debounce for Watch Mode

Date: 2026-03-24

## Context

Watch mode (DR-0081) uses a 300ms trailing-edge debounce to coalesce rapid filesystem events before re-rendering. This means even a single file save incurs a 300ms delay before the screen updates — noticeable when using the watch dashboard alongside an editor. The dominant use case is a developer saving one file and glancing at the dashboard; bursty multi-file operations (git commit, rebase) are less frequent.

## Options

### Trailing-edge only (status quo)
Every filesystem event resets a 300ms timer. Render fires only after events stop.
- **Pros:** Never shows intermediate state. Exactly one render per burst.
- **Cons:** 300ms minimum latency for the common single-file case.

### Leading + trailing edge
React immediately to the first event after a quiet period. Debounce subsequent events normally (300ms trailing). Return to leading-edge mode when events settle.
- **Pros:** Instant response for single-file saves. Only one extra render for bursty operations.
- **Cons:** Multi-file git operations may briefly show intermediate state (corrected by the trailing render ~400ms later).

### Throttle (fixed max rate)
Render at most once per 300ms during sustained activity.
- **Pros:** Guaranteed max render rate.
- **Cons:** During sustained activity (2s of events), fires ~7 renders vs 2 for leading+trailing. More CPU-intensive.

## Decision

Leading + trailing edge debounce. An `idle` flag tracks whether the system is ready for an immediate render. When `idle`, the first event triggers a render and clears the flag. When events settle (render completes with no pending events), the flag resets.

## Reasoning

The common case is a single file save, where leading-edge provides instant feedback with no intermediate-state risk. Bursty operations show a brief intermediate state, but the trailing render corrects it within ~400ms — acceptable for a live dashboard. The implementation adds one boolean (`idle`) to the existing state machine with no structural changes.

## Consequences

- Single-file edits appear on screen instantly instead of after 300ms.
- Multi-file git operations (commits, rebases) may briefly show intermediate state before the trailing render corrects it. This is a minor visual trade-off.
- Bursty events produce 2 renders (leading + trailing) instead of 1, adding negligible CPU overhead.
- The mute window (which suppresses events from the render's own git operations) interacts correctly: events during mute are dropped, and `idle` resets via the `doRender` completion path regardless.
