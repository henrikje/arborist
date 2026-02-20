# Fetch by Default for Mutation Commands

Date: 2026-02-16

## Context

Running `arb rebase` without first running `arb fetch` caused rebases onto stale `origin/main` — the local tracking ref hadn't been updated, so arb thought the feature branch was already up to date. This caused unnecessary re-work multiple times. The question was whether mutation commands should fetch automatically, and how to handle the asymmetry between mutation commands (where stale data causes real problems) and read-only commands (where fetch latency hurts responsiveness).

## Options

### Fetch opt-in for all commands (status quo)
Keep `--fetch` as an explicit flag on rebase, merge, and push. Users must remember to fetch before mutating.
- **Pros:** Predictable — no hidden network activity. Fast for offline or known-fresh scenarios.
- **Cons:** Easy to forget, leading to stale rebases. Every test and workflow requires an extra `arb fetch` step. The "happy path" (correct behavior) requires extra effort.

### Fetch by default for mutations, opt-in for reads
Mutation commands (`push`, `pull`, `rebase`, `merge`) auto-fetch with `--no-fetch` opt-out. Read-only commands (`status`, `list`) keep `--fetch` opt-in.
- **Pros:** Eliminates the most common foot-gun. The parallel pre-fetch serves double duty — freshness and performance (concurrent fetch upfront avoids per-repo fetch latency during sequential operations). Offline usage degrades gracefully (fetch warns and continues with stale data).
- **Cons:** Adds 1-3 seconds of latency to every mutation command. Users with known-fresh refs pay the cost unnecessarily.

## Decision

Fetch by default for mutation commands, with `--no-fetch` opt-out. Read-only commands stay opt-in with `--fetch`.

## Reasoning

The asymmetry is intentional: mutation commands operate on remote state and produce incorrect results with stale data (rebasing onto an old target, pushing when behind). The cost of a redundant fetch (1-3 seconds) is far less than the cost of a stale rebase (re-work, force-push, potential conflicts). Read-only commands are used frequently for quick checks and shouldn't pay fetch latency by default.

Fetch failures warn and continue rather than blocking — this avoids hostile behavior for offline users while still providing the freshness benefit when network is available. This principle was codified in GUIDELINES.md as "Mutating commands fetch by default, read-only commands do not."

## Consequences

Workflows simplify: `arb rebase --yes` replaces `arb fetch && arb rebase --yes`. Integration tests no longer need manual fetch steps before mutations. The `--no-fetch` flag is available for CI scripts or known-fresh scenarios. `arb list` gains `--fetch` for users who want fresh data before scanning all workspaces.
