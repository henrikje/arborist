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
- **`remotes.ts`** — resolves remote roles (upstream/publish) for fork workflows; supports `remote.pushDefault`, `upstream`+`origin` convention, and single-remote repos
- **`status.ts`** — per-repo and per-workspace status gathering (`gatherRepoStatus`, `gatherWorkspaceSummary`), verdict classification (`isDirty`, `isUnpushed`, `getVerdict`)
- **`integrate.ts`** — shared rebase/merge logic: assess repos, display plan, confirm, execute sequentially with conflict recovery guidance
- **`worktrees.ts`** — two-phase worktree creation: parallel fetch then sequential worktree add, with upstream tracking setup
- **`workspace-branch.ts`** — resolves the branch for a workspace from `.arbws/config`, with fallback inference from the first worktree
- **`workspace-context.ts`** — `requireWorkspace()` and `requireBranch()` helpers that exit on missing context
- **`repos.ts`** — lists workspaces (dirs containing `.arbws`), canonical repos, interactive repo selection, and repo classification (remote vs local)
- **`config.ts`** — INI-style config reader/writer for `.arbws/config` files (`key = value` format)
- **`parallel-fetch.ts`** — concurrent git fetch with configurable timeout (`ARB_FETCH_TIMEOUT` env var, default 120s)
- **`output.ts`** — TTY-aware colored output helpers; `success/info/warn/error` write to stderr, `stdout` writes to stdout, `inlineStart/inlineResult` for progress lines
- **`tty.ts`** — TTY detection helper used by output formatting

### Testing

- **Unit tests**: Bun's native test runner, files colocated as `*.test.ts`. Intended for code that can be tested without spawning git processes or filesystem operations.
- **Integration tests**: BATS framework in `test/arb.bats`, tests the compiled binary end-to-end. Should provide a comprehensive coverage of the CLI's behavior.

## Post-Change Checklist

After each change, check whether the following need updating:

- **README.md** — If the change affects user-facing behavior, CLI usage, configuration, or workflows, update the relevant README sections.
- **Command help text** — If the change modifies a command's options, arguments, or behavior, update the command's `.description()` and `.option()` help strings in `src/commands/`.
- **BATS integration tests** — Always add new tests to this suite when making changes that affect CLI behavior.

## Code Style

- Biome enforces: tabs, 120 char line width, double quotes, always semicolons
- Conventional commits enforced via commitlint
- Strict TypeScript with `noUncheckedIndexedAccess`
- Uses Bun's `$` shell template literals for git process spawning
