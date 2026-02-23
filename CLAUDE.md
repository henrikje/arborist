# CLAUDE.md

## Project Overview

Arborist (`arb`) is a workspace manager for multi-repo projects. It uses Git worktrees to let developers work on multiple features across several repositories in parallel. Built with Bun and TypeScript.

Key concepts: an `.arb/` marker directory lives at the project root, canonical repos are cloned into `.arb/repos/` (kept in detached HEAD state), and workspaces are top-level directories containing git worktrees on feature branches.

Must read [GUIDELINES.md](GUIDELINES.md) before making changes. It documents the design principles, UX conventions, and architectural patterns that all code must follow.

## Getting Started

Run `bun install` before developing.

## Commands

| Command | Purpose |
|---------|---------|
| `bun run dev -- <args>` | Run CLI locally (passes args to arb) |
| `bun run build` | Build single executable to `dist/arb` |
| `bun test` | Run all unit tests |
| `bun test src/lib/git.test.ts` | Run a single test file |
| `bun run test:integration` | Build and run BATS integration tests |
| `bun run lint` | Check with Biome (formatting + linting) |
| `bun run lint:fix` | Auto-fix lint/format issues |
| `bun run typecheck` | TypeScript type checking |
| `bun run check` | Run all checks (lint, typecheck, unit tests, integration tests) |

Always use these Bun scripts instead of running commands directly. 

## Architecture

### Entry Point

`src/index.ts` — sets up the Commander CLI program and registers all commands.

### Commands (`src/commands/`)

Each command exports a `register*Command(program, getCtx)` function. The `getCtx` callback lazily resolves `ArbContext` (base dir, repos dir, current workspace).

### Core Libraries (`src/lib/`)

- **`types.ts`** — `ArbContext` interface (baseDir, reposDir, currentWorkspace)
- **`base-dir.ts`** — walks up the directory tree to find the `.arb/` marker and detects if cwd is inside a workspace
- **`git.ts`** — git process spawning, branch validation, status parsing, remote detection, default branch resolution
- **`remotes.ts`** — resolves remote roles (upstream/share) for fork workflows; supports `remote.pushDefault`, `upstream`+`origin` convention, and single-remote repos
- **`status.ts`** — the canonical status model. Defines `RepoStatus` (5-section model: identity, local, base, share, operation), `RepoFlags` (independent boolean flags), named flag sets (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`), and shared functions (`computeFlags`, `isAtRisk`, `wouldLoseWork`, `flagLabels`). Also provides `gatherRepoStatus` and `gatherWorkspaceSummary`. This is Arborist's single source of truth for repository state — all commands that need to understand repo state must use this model, not invent local representations. See the "Canonical status model" section in GUIDELINES.md
- **`integrate.ts`** — shared rebase/merge logic: assess repos, display plan, confirm, execute sequentially with conflict recovery guidance
- **`worktrees.ts`** — two-phase worktree creation: parallel fetch then sequential worktree add, with upstream tracking setup
- **`workspace-branch.ts`** — resolves the branch for a workspace from `.arbws/config`, with fallback inference from the first worktree
- **`workspace-context.ts`** — `requireWorkspace()` and `requireBranch()` helpers that exit on missing context
- **`repos.ts`** — lists workspaces (dirs containing `.arbws`), canonical repos, interactive repo selection, and workspace repo enumeration
- **`config.ts`** — INI-style config reader/writer for `.arbws/config` files (`key = value` format)
- **`parallel-fetch.ts`** — concurrent git fetch with configurable timeout (`ARB_FETCH_TIMEOUT` env var, default 120s)
- **`output.ts`** — TTY-aware colored output helpers; `success/info/warn/error` write to stderr, `stdout` writes to stdout, `inlineStart/inlineResult` for progress lines
- **`tty.ts`** — TTY detection helper used by output formatting

### Testing

- **Unit tests**: Bun's native test runner, files colocated as `*.test.ts`. Intended for code that can be tested without spawning git processes or filesystem operations.
- **Integration tests**: BATS framework in `test/integration/*.bats`, tests the compiled binary end-to-end. Split into domain-based files (basics, workspace-membership, list-nav, status, sync, integrate, exec-open, templates, forks) with shared helpers in `test/integration/test_helper/common-setup.bash`. Run all with `bun run test:integration` or target a single file with `bun run build && bats test/integration/<file>.bats`.
- **Playground scripts**: `test/playground/` contains setup scripts that create self-contained arb playgrounds for manual exploration. Run `test/playground/setup-walkthrough.sh` or `test/playground/setup-stacked.sh` to create a ready-to-explore environment.

## Decision Records

The `decisions/` directory contains records of significant design and product decisions. Each file captures the context, options considered, chosen approach, and reasoning. Read relevant decision records before proposing changes to features they cover — the reasoning for past choices may still apply.

After implementing a feature whose plan involved a significant decision, distill a `decisions/NNNN-*.md` from the plan — stripping implementation details, keeping only context, options, decision, reasoning, and consequences. If the decision reveals a new enduring principle, add it to GUIDELINES.md and reference it from the decision record. See `decisions/README.md` for the template and heuristic on what warrants a record.

Existing decision files must never be modified. They are permanent records of past reasoning. If a decision is later revisited or reversed, write a new decision record that references the original.

## Post-Change Checklist

After each change, check whether the following need updating:

- **README.md** — If the change affects user-facing behavior, CLI usage, configuration, or workflows, update the relevant README sections.
- **Command help text** — If the change modifies a command's options, arguments, or behavior, update the command's `.description()` and `.option()` help strings in `src/commands/`.
- **BATS integration tests** — Always add new tests to this suite when making changes that affect CLI behavior.

## Code Style

- Indent with tabs (not spaces). Biome enforces: tabs, 120 char line width, double quotes, always semicolons
- Conventional commits enforced via commitlint
- Strict TypeScript with `noUncheckedIndexedAccess`
- Uses Bun's `$` shell template literals for git process spawning
