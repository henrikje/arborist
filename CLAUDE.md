# CLAUDE.md

## Project Overview

Arborist (`arb`) is a workspace manager for multi-repo projects. It uses Git worktrees to let developers work on multiple features across several repositories in parallel. Built with Bun and TypeScript.

Key concepts: `arb init` creates a project — an `.arb/` marker directory lives at the project root, canonical repos are cloned into `.arb/repos/` (kept in detached HEAD state), and workspaces are top-level directories containing git worktrees on feature branches.

**Always read [GUIDELINES.md](GUIDELINES.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before making any changes.** GUIDELINES covers design principles and UX conventions. ARCHITECTURE covers technical patterns and decision records. All code must follow both.

## Getting Started

Run `bun install` before developing.

## Code Organization

### Entry Point

`src/index.ts` — sets up the Commander CLI program and registers all commands.

### Commands (`src/commands/`)

Each command exports a `register*Command(program, getCtx)` function. The `getCtx` callback lazily resolves `ArbContext` (arb root dir, repos dir, current workspace) only when the command's action handler runs. Commands like `init` and `help` never need a valid arb root.

### Libraries (`src/lib/`)

Organized into semantic subdirectories. Each directory has a barrel `index.ts` re-exporting its public API.

**Import rules — circular dependencies are not allowed:**
- Sibling-to-sibling imports between directories are allowed (e.g. `render/` can import from `status/`).
- Children must not import from parents (e.g. a file in `render/` must not import from `render/index.ts`). Share types via a `types.ts` file instead.
- No circular dependencies between files or directories. Enforced by `bun run cycles` (madge). If a cycle is detected, extract the shared type into a `types.ts` leaf file.
- Within `lib/`, use direct file imports (not barrels) to avoid circular dependency issues.
- Command files and `src/index.ts` use barrel imports.

- **`core/`** — Foundation: `types.ts` (ArbContext), `errors.ts` (ArbError, ArbAbort), `config.ts` (INI reader/writer), `arbignore.ts`, `time.ts` (relative time formatting)
- **`terminal/`** — Terminal I/O: `output.ts` (ANSI colors, logging, progress), `tty.ts` (TTY detection), `debug.ts`, `stdin.ts`, `abort-keypress.ts`
- **`git/`** — Git operations: `git.ts` (process spawning, branch/status/remote ops), `git-cache.ts` (request-scoped promise coalescing), `remotes.ts` (remote role resolution), `remote-url.ts` (URL parsing, PR URL construction)
- **`status/`** — Canonical status model: `status.ts` (RepoStatus, RepoFlags, gathering, filtering — see ARCHITECTURE.md), `skip-flags.ts`, `pr-detection.ts`, `ticket-detection.ts`, `test-helpers.ts` (makeRepo fixtures)
- **`render/`** — Declarative render model: `model.ts` (Cell, Span, Attention, OutputNode types, cell helpers — zero lib imports), `analysis.ts` (analyze* functions, buildStatusCountsCell, formatStatusCounts, flagLabels), `render.ts` (OutputNode[] → ANSI string), `status-view.ts`, `status-verbose.ts`, `conflict-report.ts`, `repo-header.ts`, `plan-format.ts`, `integrate-graph.ts`, `phased-render.ts`
- **`workspace/`** — Workspace management: `arb-root.ts` (.arb/ marker detection), `repos.ts` (repo listing, selection), `worktrees.ts`, `branch.ts` (workspace branch detection), `context.ts` (requireWorkspace/requireBranch guards), `clean.ts`, `templates.ts`
- **`sync/`** — Synchronization: `integrate.ts` (shared rebase/merge logic), `parallel-fetch.ts` (concurrent fetch with timeout), `mutation-flow.ts` (confirmation prompts, phased render integration)
- **`json/`** — JSON output: `json-types.ts` (Zod schemas), `json-schema.ts`
- **`help/`** — Help topics

### Testing

- **Unit tests**: Bun's native test runner, files colocated as `*.test.ts` under `src/`. For code testable without spawning git processes or filesystem operations.
- **Integration tests**: Bun test files in `test/integration/*.test.ts`, tests the compiled binary end-to-end. Shared helpers in `test/integration/helpers/env.ts` provide `createTestEnv()`, `arb()`, `git()`, and fixtures.
- **Playground scripts**: `test/playground/` contains setup scripts for self-contained arb playgrounds. Run `test/playground/setup-walkthrough.sh` or `test/playground/setup-stacked.sh` for a ready-to-explore environment.

### Code Style

- Indent with tabs (not spaces). Biome enforces: tabs, 120 char line width, double quotes, always semicolons
- Conventional commits enforced via commitlint
- Use `PROJ-xxx` as the example ticket key prefix in documentation and examples. Use `ACME-xxx` when a second distinct prefix is needed
- Strict TypeScript with `noUncheckedIndexedAccess`
- Uses the `git()` helper from `src/lib/git/git.ts` for git process spawning. Use `Bun.$` directly only for piped commands and `git clone` (which has no `-C` flag)

## Commands

| Command | Purpose |
|---------|---------|
| `bun run dev -- <args>` | Run CLI locally (passes args to arb) |
| `bun run build` | Build single executable to `dist/arb` |
| `bun run test` | Run all unit tests (src/) |
| `bun test src/lib/git/git.test.ts` | Run a single unit test file |
| `bun run test:integration` | Build and run Bun integration tests |
| `bun run build && bun test test/integration/sync.test.ts` | Run a single integration test file |
| `bun run test:integration:git217` | Build Docker image with git 2.17 and run integration tests |
| `bun run lint` | Check with Biome (formatting + linting) |
| `bun run lint:fix` | Auto-fix lint/format issues |
| `bun run typecheck` | TypeScript type checking |
| `bun run cycles` | Check for circular dependencies (madge) |
| `bun run check` | Run all checks (lint, typecheck, cycles, unit tests, integration tests) |

Always use these Bun scripts instead of running commands directly.

## PR Guidelines

- Never include a "References:" ticket line or any ticket/issue references in PR descriptions.

## Post-Change Checklist

After each change, check whether the following need updating:

- **Documentation** — For user-facing changes, always update the relevant file under `docs/`. Update `README.md` for important changes to behavior, CLI usage, configuration, or workflows.
- **Command help text** — If the change modifies a command's options, arguments, or behavior, update `.description()` and `.option()` help strings in `src/commands/`.
- **Shell tab completion** — If the change adds, removes, or renames a command option or subcommand, update both `shell/arb.bash` and `shell/arb.zsh`.
- **Integration tests** — Always add new tests when changes affect CLI behavior. If any existing integration tests fail after a change, report the failure to the user with the reason, and explain what you plan to do before making fixes.
- **Decision records** — If the change involved a significant design decision, write a `decisions/NNNN-*.md`. See `decisions/README.md` for the template. Existing records must never be modified.
