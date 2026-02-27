# Skip flag taxonomy for benign vs attention skips

Date: 2026-02-27

## Context

When running `arb rebase`, `arb pull`, or `arb push`, the plan shows skipped repos in yellow. Per GUIDELINES.md, yellow means "noteworthy, needs attention." But some skips are completely benign — the repo was merged, has no commits, or simply doesn't participate. These don't need attention and shouldn't compete visually with actual problems like detached HEAD or dirty worktree. Additionally, the codebase had fragile string matching on skip reasons in two places in `integrate.ts` to distinguish specific skip types.

## Options

### Boolean flag on assessments

Add `skipBenign?: boolean` to each assessment type. Set it at the return sites. Formatters check the boolean.

- **Pros:** Minimal change, follows existing assessment patterns.
- **Cons:** Too coarse — only distinguishes benign/attention. Doesn't address the existing string matching. If more categories emerge later, needs replacing.

### Prefix matching in formatters

Define a `BENIGN_SKIP_PREFIXES` array and match against `skipReason` strings in the formatters.

- **Pros:** Zero changes to assessment types.
- **Cons:** Fragile — wording tweaks silently change colors. Adds more string matching when we already have two instances that should be cleaned up.

### Typed `SkipFlag` union with `BENIGN_SKIPS` set

Define a `SkipFlag` string literal union for all skip reasons across commands. Each assessment carries `skipFlag?: SkipFlag` alongside `skipReason`. A `BENIGN_SKIPS` set determines dim vs yellow. The existing string matches migrate to flag checks.

- **Pros:** Type-safe — new flags must be added to the union. Machine-readable — no string matching anywhere. The benign set is declarative and obvious. Fixes the two existing fragile string matches. Extensible if more categories are needed later.
- **Cons:** ~20 return sites need `skipFlag` added across 3 assess functions. New shared type to maintain.

## Decision

Typed `SkipFlag` union with `BENIGN_SKIPS` set, implemented in `src/lib/skip-flags.ts`.

## Reasoning

The flags approach follows the codebase's preference for structured data (cf. `RepoFlags`, `RepoStatus` in `status.ts`). It makes the skip taxonomy explicit and type-safe — the compiler catches missing or invalid flags. It also solves the existing technical debt: the two fragile string matches in `integrate.ts` (`startsWith("no base branch")` and `includes("was merged into default")`) migrated to clean flag comparisons. The boolean approach would have been simpler but wouldn't have addressed the string matching, and would need replacing if more skip categories emerge. The prefix matching approach would have made the fragility problem worse.

## Consequences

Every new skip reason must add a member to the `SkipFlag` union and set it at the return site. This is a small cost that prevents silent drift between skip reasons and their classification. The `BENIGN_SKIPS` set is the single place to decide whether a skip is benign or needs attention. If a third visual category is needed later (e.g. a distinct style for "actionable but not urgent"), the flag infrastructure supports it without structural changes — just add a new set.
