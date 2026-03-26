# Mute Window Deferred Render

Date: 2026-03-26

Amends: DR-0094 (Leading-Edge Debounce)

## Context

Watch mode's post-render mute window (300ms) was designed to suppress filesystem events caused by the render's own git operations (e.g. `git status` refreshing the index). Events during the mute were silently dropped. This caused a bug: external changes (commits made from another terminal, Claude committing a repo) that happened to arrive during the mute window were also dropped, leaving the dashboard stale with no subsequent trigger to re-render.

## Options

### Drop events during mute (status quo)
Silently return from `scheduleRender` when `Date.now() < muteUntil`.
- **Pros:** No extra renders from the render's own git operations.
- **Cons:** External changes during the mute window are permanently lost. The dashboard becomes stale until another event arrives.

### Defer events during mute
Set `dirty = true` and schedule a single deferred render after the mute expires.
- **Pros:** External changes are always picked up. At most ~300ms additional latency.
- **Cons:** 1-2 extra renders per render cycle as the system settles (the deferred render's own git operations trigger events that are themselves deferred, converging when the index stat cache is fresh).

## Decision

Defer events during the mute window. A `muteTimer` schedules a single deferred render after the mute expires. The timer is deduplicated (only one pending at a time) and cleared when `doRender`'s own dirty handler takes over or when the loop stops.

## Reasoning

The mute window's purpose is to prevent a render cascade from our own git operations, not to drop external signals. Deferring achieves both: the immediate cascade is prevented (events are delayed past the mute), while external changes are guaranteed to trigger a re-render. The convergence overhead (1-2 extra renders, ~700ms) is negligible for a live dashboard.

## Consequences

- External changes (commits, branch updates) during the mute window are always picked up within ~300ms.
- Each render cycle may produce 1-2 extra trailing renders as the system settles. This converges because `git status` is idempotent once the index stat cache is fresh.
- DR-0094 line 39 ("events during mute are dropped") is superseded by this decision.
