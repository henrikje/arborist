# Restore `template add`, keep `template remove` removed

Date: 2026-02-26

## Context

Decision 0037 removed both `template add` and `template remove` based on the "Minimal, semantic CLI" principle — they were thin wrappers around `cp` and `rm` on user-owned space. However, real-world onboarding showed that `template add` provides value beyond copying: it infers the correct scope (workspace vs repo) from the source path's location, resolving the non-obvious question of whether a file goes into `.arb/templates/workspace/` or `.arb/templates/repos/<name>/`. New users don't yet have the mental model of the template directory structure.

## Options

### Restore both `template add` and `template remove`

Fully revert decision 0037.

- **Pros:** Symmetric API, everything reverted cleanly
- **Cons:** `template remove` genuinely doesn't add value — `arb template list` + `rm` is obvious and sufficient

### Restore only `template add`

Partial reversal: bring back `add` for its scope-inference UX, leave `remove` deleted.

- **Pros:** Addresses the onboarding gap without reintroducing commands that don't earn their place
- **Cons:** Asymmetric (add exists, remove doesn't) — may surprise users

### Keep both removed, improve docs instead

Add a "quick start" section to the template docs explaining the directory layout.

- **Pros:** No code to maintain
- **Cons:** Doesn't solve the problem — users still need to know the path structure before they can act

## Decision

Restore only `template add`. Keep `template remove` removed. Amend the "Minimal, semantic CLI" guideline with a narrow exception for onboarding UX through non-obvious inference.

## Reasoning

The asymmetry is intentional and justified by the asymmetry in the underlying problem: *adding* requires knowing where to put something (non-trivial for new users), while *removing* requires knowing what to delete (trivially answered by `arb template list` + `rm`). `template add` earns its place through source-path scope inference — a piece of domain knowledge that requires understanding the workspace structure. `template remove` is a plain `rm` with directory cleanup, which doesn't require Arborist's understanding.

The guideline amendment is deliberately narrow: the exception applies only when a command provides onboarding UX through non-obvious path or scope inference. This doesn't open the door to wrapping every filesystem operation.

## Consequences

- `arb template add` is restored with the exact pre-0037 behavior: source-path scope inference, directory support, `--force` flag
- `arb template remove` remains removed — users use `rm` directly
- The "Minimal, semantic CLI" guideline gains a clarifying exception sentence
- If future commands face similar "thin wrapper but useful inference" questions, this decision provides precedent
