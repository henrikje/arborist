# Parallel exec mode

Date: 2026-03-14

## Context

`arb exec` runs a command sequentially in each workspace repo — printing a `==> repo <==` header, spawning the command with inherited stdin/stdout/stderr, and waiting for it to finish before moving to the next repo. This design supports interactive programs but is slow for non-interactive commands like `npm install` or `make build` across many repos. An optional parallel mode was needed.

Three questions shaped the design: how to order output when repos complete at different times, how many concurrent processes to allow, and how to handle stdin when multiple processes run simultaneously.

## Options

### Output ordering: completion order
Print each repo's buffered output as soon as it finishes. The user sees results as quickly as possible.
- **Pros:** Maximum responsiveness; simple implementation.
- **Cons:** Output order varies between runs, making it harder to scan for a specific repo. Inconsistent with the predictable alphabetical ordering users expect from `==> repo <==` headers.

### Output ordering: batch alphabetical
Buffer all output, print everything after the slowest repo finishes, in alphabetical order.
- **Pros:** Consistent and scannable.
- **Cons:** Terminal sits silent until the slowest repo finishes, which can be tens of seconds for installs.

### Output ordering: streaming in-order
Maintain an ordered queue. When a repo completes, emit it only if all preceding repos have already been emitted. This produces alphabetical output while allowing early repos to stream as soon as they finish.
- **Pros:** Consistent output order; responsive when early repos finish first; modest implementation complexity (an index counter and a buffer map).
- **Cons:** If the alphabetically-first repo is the slowest, all output is delayed until it finishes (degrades to batch behavior). Slightly more complex than the other two options.

### Concurrency: unlimited
Use `Promise.all` with no concurrency limit, matching the `parallelFetch` pattern.
- **Pros:** Simple; typical workspaces have 2–8 repos, so this means 2–8 processes. Matches existing precedent.
- **Cons:** Could overwhelm the system for CPU-bound commands in very large workspaces.

### Concurrency: configurable (`--jobs N`)
Add a `-j N` / `--jobs N` flag to cap concurrent processes.
- **Pros:** Protects against overload for CPU-bound tasks.
- **Cons:** Adds a flag most users won't need. Premature for a feature whose typical concurrency is single digits.

## Decision

Streaming in-order output ordering with unlimited concurrency. A `--jobs` flag can be added later if users report overload problems.

## Reasoning

The GUIDELINES emphasize that `exec` output uses `==> repo <==` section headers for visual scanning — users look for a repo name and read downward. Stable ordering preserves this workflow. Streaming in-order is the best balance: it avoids the dead-silence problem of batch ordering while maintaining the consistency of alphabetical output. The implementation complexity is modest and follows the `parallelFetch` pattern of concurrent execution with aggregate results.

Unlimited concurrency is appropriate because the existing `parallelFetch` validates this pattern, and typical workspace sizes (2–8 repos) are well within reasonable process counts. Adding a `--jobs` flag now would violate the "avoid over-engineering" principle for a constraint that hasn't materialized.

## Consequences

- `arb exec -p <cmd>` runs all repos concurrently with buffered, alphabetically-ordered output.
- Stdin is disabled in parallel mode (`stdin: "ignore"`). Interactive commands must use the default sequential mode.
- If a user's alphabetically-first repo is consistently the slowest, they'll see batch-like behavior. This is acceptable — the output is still correct and consistent.
- A `--jobs N` flag is a natural follow-up if large workspaces cause resource pressure. The streaming in-order queue supports bounded concurrency without architectural changes.
