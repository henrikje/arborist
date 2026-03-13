# Discriminated Sync Assessments

Date: 2026-03-13

## Context

The sync commands (`rebase`/`merge` through `RepoAssessment`, plus `pull` and `push`) all used flat assessment objects with many optional fields. As the plan and execution flows grew, those shapes allowed invalid combinations such as skip-only fields lingering on active assessments or verbose metadata appearing without the corresponding outcome. The architectural review raised the question of whether to keep these types near each command or centralize them, and whether the existing flat model still matched Arborist's plan-first workflow.

## Options

### Keep per-command flat assessment types
Each command keeps its own assessment type close to its implementation, with optional fields for all conditional state.
- **Pros:** Minimal code movement. Familiar local pattern.
- **Cons:** Invalid state combinations remain representable. Shared plan/render code has to defensively read optional fields. Similar concepts drift across commands.

### Centralize assessments in `sync/types.ts` as discriminated unions
Move the shared mutation assessment models into `sync/types.ts` and model them as `outcome`-based unions, grouping related metadata into nested subobjects.
- **Pros:** Invalid state combinations become harder to express. Shared render and execution code narrow on `outcome`. Common concepts (`retarget`, `verbose`, `safeReset`) get stable homes.
- **Cons:** Requires broad refactoring across command, render, and test code. Moves types away from the immediate command file.

## Decision

Centralize `RepoAssessment`, `PullAssessment`, and `PushAssessment` in `sync/types.ts` and model them as discriminated unions keyed by `outcome`. Related conditional metadata is grouped into nested objects such as `retarget`, `verbose`, and `safeReset`.

## Reasoning

Arborist's state-changing commands all follow the same assess → plan → confirm → execute → summarize flow from GUIDELINES.md. In that workflow, the assessment object is the contract between phases. That contract should be explicit and compiler-enforced, not a bag of optional fields that downstream code has to interpret defensively.

The union model also fits the "safe and simple parallel multi-repo development" principle. A plan should be an honest statement of what Arborist thinks will happen. By making skip-only data live only on skip variants, and operation-specific metadata live only where it applies, the code better reflects the real plan the user reviews.

## Consequences

`sync/types.ts` is now the source of truth for the shared sync assessment models. Command, render, and execution code should narrow on `outcome` and then read nested metadata from the appropriate subobject. Future mutation commands that need shared plan/render logic should prefer extending these union patterns over introducing new flat optional-field models.
