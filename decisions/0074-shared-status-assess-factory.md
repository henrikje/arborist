# Shared Status Assess Factory

Date: 2026-03-13

## Context

`pull`, `push`, `rebase`/`merge`, and `reset` all had nearly identical assess callbacks: keep a `prevStatuses` map, reuse statuses for `unchangedRepos`, call `gatherRepoStatus()`, apply `--where`, and then hand the result to command-specific classification logic. The architectural review called out that this duplication was mechanical rather than domain-specific, but also warned against pushing command logic down into `runPlanFlow()`.

## Options

### Leave the duplicated assess closures in each command
Each command keeps its own inline closure for status caching, no-op fetch reuse, status gathering, and filtering.
- **Pros:** No new abstraction. All logic stays in the command file.
- **Cons:** Repeated boilerplate across four commands. Small fixes to caching or filtering have to be copied everywhere.

### Move the shared mechanics into `runPlanFlow()`
Teach the orchestration layer how to gather status, cache results, and apply `--where`.
- **Pros:** Reduces repetition at the call sites.
- **Cons:** `runPlanFlow()` becomes coupled to `RepoStatus`-based commands and starts to own domain assumptions it should not know about.

### Extract a focused helper that builds assess callbacks
Create a helper in `sync/` that owns only the duplicated mechanics and accepts a command-specific classifier callback.
- **Pros:** Removes duplication while keeping command policy local. Preserves `runPlanFlow()` as a small orchestration primitive. Matches the "do one thing and do it well" guideline.
- **Cons:** Introduces another helper boundary to understand.

## Decision

Extract `buildCachedStatusAssess()` in `sync/assess-with-cache.ts`. It owns previous-status caching, `unchangedRepos` reuse, `gatherRepoStatus()`, and `--where` filtering, while each command supplies its own classifier callback.

## Reasoning

The duplicated code was structural, not semantic. Arborist gains value from command-specific classification, conflict handling, and plan rendering, not from repeating the same status-cache plumbing in four places. A small helper keeps that plumbing consistent without moving policy out of the command domain.

Keeping this out of `runPlanFlow()` is equally important. `runPlanFlow()` coordinates phases; it should not assume commands are status-based or know how to classify repos. That separation preserves the explicit five-phase workflow from GUIDELINES.md and keeps orchestration independent from assessment details.

## Consequences

Mutation commands that assess from `RepoStatus` should use `buildCachedStatusAssess()` rather than duplicating the closure pattern. `runPlanFlow()` remains generic and unaware of status semantics. If a future command needs different gather/filter mechanics, it should use a different helper instead of widening this one into a catch-all abstraction.
