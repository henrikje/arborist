# Introduce "project" as the primary user-facing concept

Date: 2026-03-03

## Context

The entity created by `arb init` — a directory containing `.arb/`, canonical repos, and workspaces — had no concept-level name. It was called "arb root" everywhere, but "arb root" describes a filesystem location, not a thing. You can't naturally say "I have two arb roots" the way you'd say "I have two projects." The codebase already used "project" informally in several places (init.ts help text, README directory examples, test helpers).

## Options

### Option A: "Project" as the user-facing concept, internal code unchanged

User-facing strings change from "arb root" to "project" or "project root." Internal code (`arbRootDir`, `detectArbRoot`) stays as-is because it correctly describes the directory. Template variable `root.path` becomes `project.path`.

- **Pros:** Small change (~25 files). No logic or type changes. "Project" is universally understood. Internal code remains precise.
- **Cons:** "Project" can overlap with the user's software project. Mitigated by CLI context and qualifying as "Arborist project" in documentation when needed.

### Option B: Full rename including internal code

Everything in Option A plus renaming `arbRootDir` to `projectDir`, `detectArbRoot()` to `detectProject()`, etc.

- **Pros:** Total consistency.
- **Cons:** 350+ symbol renames across 40+ files. `arbRootDir` already correctly refers to the directory. Would collide with existing `TestEnv.projectDir` in test helpers.

### Option C: Alternative terms (grove, garden, base, home)

- **Cons:** No alternative is as immediately clear as "project."

## Decision

Option A. Introduce "project" as the primary user-facing term. Qualify as "Arborist project" in documentation when both senses of "project" appear nearby; use unqualified "project" in CLI output where the `arb` command context disambiguates.

## Reasoning

"Project" is what users already call it informally. The GUIDELINES.md principle "prefer correctness over backwards compatibility" supports this pre-1.0 terminology change. Internal code correctly refers to the directory as `arbRootDir` — it IS the arb root directory, and renaming it would make it less specific. This follows decision 0035's pattern of user-facing simplicity with internal precision.

The qualification strategy (qualify in docs, not in CLI) matches how Git, Docker Compose, and JetBrains handle tool-specific "project" terms — tool output says "project" unqualified, documentation disambiguates when needed.

## Consequences

- Users see consistent "project" language across CLI output, help text, error messages, and documentation.
- The template variable `root.path` is renamed to `project.path` — existing `.arbtemplate` files using `root.path` must be updated.
- Internal code symbols (`arbRootDir`, `detectArbRoot`, `reposDir`) remain unchanged, keeping the codebase precise about what it references (directories vs concepts).
- "Arb root" remains valid as a narrow technical synonym for "project root" in debug output and internal documentation.
