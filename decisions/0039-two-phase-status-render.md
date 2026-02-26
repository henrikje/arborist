# Two-Phase Rendering for Status

Date: 2026-02-26

## Context

When a user runs `arb status -F`, the command blocks on `parallelFetch()` for 1-3 seconds before showing anything. Since local tracking refs already exist (just stale), the status table can be rendered immediately from stale data, then refreshed after the fetch completes. Mutation commands (`push`, `pull`, `rebase`, `merge`) already implement this pattern inline in `runPlanFlow` (`mutation-flow.ts`). Adding a second inline implementation in `status.ts` would duplicate the orchestration logic.

## Options

### Inline implementation in status.ts

Duplicate the two-phase orchestration logic directly in `runStatus`, matching what `runPlanFlow` does.

- **Pros:** Simple, self-contained, no abstraction overhead.
- **Cons:** Duplicates orchestration logic (start silent fetch, render stale, append "Fetching...", await, clear, render fresh, report failures). Two sites to update if the pattern changes.

### Shared helper extracted from runPlanFlow

Extract a generic `runTwoPhaseRender` helper that both `runPlanFlow` and `runStatus` call with customized callbacks for gathering data and formatting output.

- **Pros:** Single orchestration site. Consistent behavior (same indicator style, same clearing, same failure reporting). Easy to extend to future commands (e.g. `list -F`).
- **Cons:** Adds an abstraction layer. Callers must conform to the gather/format callback pattern.

## Decision

Extract a shared `runTwoPhaseRender<T>` helper in `src/lib/two-phase-render.ts`. Both `runPlanFlow` and `runStatus` use it with command-specific callbacks.

## Reasoning

The orchestration sequence is identical across consumers — only the data gathering and formatting differ. The callback-based API (`gather`, `format`, `writeStale`, `writeFresh`) cleanly separates the invariant orchestration from command-specific logic. The `writeStale`/`writeFresh` callbacks enable status's stream strategy (stale to stderr, fresh to stdout) while mutation commands default both to stderr. This follows the "shared library composition" pattern from GUIDELINES.md.

## Consequences

- All two-phase sites share the same indicator style, clearing behavior, and failure reporting.
- Future commands (e.g. `list -F`) can adopt two-phase rendering by calling `runTwoPhaseRender` without duplicating orchestration.
- The `clearLines`/`countLines` clearing approach using `\x1B[J` (erase to end of screen) handles output length changes between renders correctly.
- Status's stream strategy (stale to stderr, fresh to stdout) means `arb status -F | jq` shows the stale preview on the terminal while the pipe receives only clean fresh output.
