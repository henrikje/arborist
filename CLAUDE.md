# CLAUDE.md

## Project Overview

Arborist (`arb`) is a workspace manager for multi-repo projects. It uses Git worktrees to let developers work on multiple features across several repositories in parallel. Built with Bun and TypeScript.

Key concepts: an `.arb/` marker directory lives at the project root, canonical repos are cloned into `.arb/repos/` (kept in detached HEAD state), and workspaces are top-level directories containing git worktrees on feature branches.

**Always read [GUIDELINES.md](GUIDELINES.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before making any changes.** GUIDELINES covers design principles and UX conventions. ARCHITECTURE covers technical patterns and decision records. All code must follow both.

## Getting Started

Run `bun install` before developing.

## Code Organization

### Entry Point

`src/index.ts` — sets up the Commander CLI program and registers all commands.

### Commands (`src/commands/`)

Each command exports a `register*Command(program, getCtx)` function. The `getCtx` callback lazily resolves `ArbContext` (arb root dir, repos dir, current workspace) only when the command's action handler runs. Commands like `init` and `help` never need a valid arb root.

### Core Libraries (`src/lib/`)

- **`types.ts`** — `ArbContext` interface (arbRootDir, reposDir, currentWorkspace)
- **`arb-root.ts`** — walks up the directory tree to find the `.arb/` marker and detects if cwd is inside a workspace
- **`git.ts`** — git process spawning, branch validation, status parsing, remote detection, default branch resolution
- **`remotes.ts`** — resolves remote roles (base/share) for fork workflows; supports `remote.pushDefault`, `upstream`+`origin` convention, and single-remote repos
- **`status.ts`** — the canonical status model. See "Canonical status model" in ARCHITECTURE.md
- **`integrate.ts`** — shared rebase/merge logic: assess repos, display plan, confirm, execute sequentially with conflict recovery guidance
- **`worktrees.ts`** — two-phase worktree creation: parallel fetch then sequential worktree add, with base remote tracking setup
- **`workspace-branch.ts`** — resolves the branch for a workspace from `.arbws/config`, with fallback inference from the first worktree
- **`workspace-context.ts`** — `requireWorkspace()` and `requireBranch()` guards that exit early with helpful messages if context is missing
- **`repos.ts`** — lists workspaces (dirs containing `.arbws`), canonical repos, interactive repo selection, and workspace repo enumeration
- **`config.ts`** — INI-style config reader/writer for `.arbws/config` files (`key = value` format)
- **`parallel-fetch.ts`** — concurrent git fetch with configurable timeout (`ARB_FETCH_TIMEOUT` env var, default 120s)
- **`output.ts`** — TTY-aware colored output helpers; `success/info/warn/error` write to stderr, `stdout` writes to stdout, `inlineStart/inlineResult` for progress lines
- **`tty.ts`** — TTY detection helper used by output formatting
- **`pr-detection.ts`** — extracts PR/MR numbers from commit subjects (GitHub, Azure DevOps patterns)
- **`remote-url.ts`** — parses git remote URLs and constructs PR URLs for GitHub, GitLab, Bitbucket, Azure DevOps
- **`ticket-detection.ts`** — detects Jira/Linear-style ticket keys from branch names and commit messages

### Testing

- **Unit tests**: Bun's native test runner, files colocated as `*.test.ts`. For code testable without spawning git processes or filesystem operations.
- **Integration tests**: BATS framework in `test/integration/*.bats`, tests the compiled binary end-to-end. Split into domain-based files with shared helpers in `test/integration/test_helper/common-setup.bash`.
- **Playground scripts**: `test/playground/` contains setup scripts for self-contained arb playgrounds. Run `test/playground/setup-walkthrough.sh` or `test/playground/setup-stacked.sh` for a ready-to-explore environment.

### Code Style

- Indent with tabs (not spaces). Biome enforces: tabs, 120 char line width, double quotes, always semicolons
- Conventional commits enforced via commitlint
- Strict TypeScript with `noUncheckedIndexedAccess`
- Uses the `git()` helper from `src/lib/git.ts` for git process spawning. Use `Bun.$` directly only for piped commands and `git clone` (which has no `-C` flag)

## Commands

| Command | Purpose |
|---------|---------|
| `bun run dev -- <args>` | Run CLI locally (passes args to arb) |
| `bun run build` | Build single executable to `dist/arb` |
| `bun test` | Run all unit tests |
| `bun test src/lib/git.test.ts` | Run a single test file |
| `bun run test:integration` | Build and run BATS integration tests |
| `bun run build && bats test/integration/status.bats` | Run a single integration test file |
| `bun run build && bats test/integration/sync.bats --filter "push skips"` | Run a single integration test by name |
| `bun run lint` | Check with Biome (formatting + linting) |
| `bun run lint:fix` | Auto-fix lint/format issues |
| `bun run typecheck` | TypeScript type checking |
| `bun run check` | Run all checks (lint, typecheck, unit tests, integration tests) |

Always use these Bun scripts instead of running commands directly.

## Post-Change Checklist

After each change, check whether the following need updating:

- **Documentation** — For user-facing changes, always update the relevant file under `docs/`. Update `README.md` for important changes to behavior, CLI usage, configuration, or workflows.
- **Command help text** — If the change modifies a command's options, arguments, or behavior, update `.description()` and `.option()` help strings in `src/commands/`.
- **Shell tab completion** — If the change adds, removes, or renames a command option or subcommand, update both `shell/arb.bash` and `shell/arb.zsh`.
- **BATS integration tests** — Always add new tests when changes affect CLI behavior.
- **Decision records** — If the change involved a significant design decision, write a `decisions/NNNN-*.md`. See `decisions/README.md` for the template. Existing records must never be modified.
