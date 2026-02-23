# QA

Reusable prompt for Claude Code. Run before a release to catch inconsistencies, stale content, and polish issues across the entire project.

## How to use

Copy the prompt below and paste it into Claude Code from the Arborist repo root.

---

## Prompt

Do a thorough QA sweep of this project. Read CLAUDE.md and GUIDELINES.md first — they define the conventions everything should be checked against. Then work through the categories below systematically.

For each category, read the relevant files, check for issues, and report what you find grouped by priority. Do not fix anything — report only. Do not give positive feedback or confirm what's working. A clean category gets a single "no issues" line.

Run `bun run check` at the end to make sure nothing is broken.

### 1. Help text accuracy

For every command in `src/commands/`, verify:

- The `.summary()` accurately describes what the command does.
- The `.description()` covers all options, arguments, and behavioral details (help is the authoritative reference per GUIDELINES.md).
- Every `.option()` has a help string that matches its actual behavior.
- Default values are documented in option help text (e.g., fetch defaults per GUIDELINES.md's "Universal fetch flags").
- Arguments like `[repos...]` are documented.
- Command groups (`repo`, `template`) have accurate subcommand help.

Cross-reference against the actual implementation — don't just check that help text exists, check that it's *correct*.

### 2. Tab completion coverage

Compare `shell/arb.bash` and `shell/arb.zsh` against the actual command set:

- Every command registered in `src/index.ts` has a completion entry. No removed commands linger as ghosts.
- Every option/flag is completable. Short flags map to the correct long flag (e.g. `-F` → `--fetch`, not `--no-fetch`).
- Dynamic completions (workspace names, repo names, template names, `--where` filter values) match what the code actually supports.
- The bash and zsh versions are functionally equivalent — same commands, same options, same dynamic values.
- The shell wrapper functions (`arb()`) handle all commands that need shell-level interception (currently `cd` and `create`).
- Internal function names reflect current command names (no legacy names from past renames).

### 3. Documentation accuracy

Check README.md and every file in `docs/` against the current codebase:

- Command names, flag names, and argument syntax match the actual CLI.
- Example commands actually work (correct flags, correct output format).
- Documented workflows reflect current behavior.
- No references to removed/renamed commands, options, or terminology. Check the decision records for any renames or removals that may not have been propagated.
- No missing documentation for commands or features added since the docs were last updated.
- Links between docs are valid.

### 4. Consistency across commands

Check that similar commands follow the same patterns as defined in GUIDELINES.md:

- State-changing commands (`push`, `pull`, `rebase`, `merge`) all follow the five-phase mutation flow.
- Membership-changing commands (`attach`, `detach`, `create`) handle `[repos...]`, interactive picker, `--all-repos`, and non-TTY errors consistently.
- Overview commands (`status`, `log`, `diff`) handle `--fetch`/`--no-fetch`, `--json`, `[repos...]` consistently. They must not fetch by default.
- Mutation commands (`push`, `rebase`, `merge`) must fetch by default. `exec` and `open` must not have fetch flags.
- `--where` filtering works the same everywhere it appears. Filter terms must be anchored to `FILTER_TERMS` in `status.ts` — no ad-hoc string comparisons.
- `--force` has per-command semantics (plan modifier in `push`, safety bypass in `delete`). Verify that help text and behavior match each command's specific contract.
- Error messages use the output module (`output.ts`) consistently — no raw `console.log` or `process.stdout.write` for human-facing output.
- Exit codes follow the convention: 0 success, 1 error, 130 user abort.

### 5. Color and output conventions

Verify adherence to the color semantics in GUIDELINES.md:

- Green is used only for final success summary lines.
- Yellow for noteworthy/attention-needed items.
- Red for errors and immediate risks.
- Dim for supplementary info.
- Default (no color) for normal content and inline results.
- Inline progress lines use `inlineStart`/`inlineResult` correctly.
- Summary lines follow the "Pushed 3 repos, 1 up to date, 2 skipped" pattern.

### 6. Safety and error handling

- All destructive operations check for `LOSE_WORK_FLAGS` or equivalent guards.
- `--force` is required to override safety gates (not `--yes`).
- `--yes` skips confirmation prompts without overriding safety checks.
- Error recovery guidance is provided for all failure modes (conflicts, auth errors, etc.).
- `requireWorkspace()` and `requireBranch()` are called before any work that needs them.
- Interactive prompts guard on `process.stdin.isTTY` (not `isTTY()`, which checks stderr). The `isTTY()` helper is for colors and progress only.
- All `@inquirer` calls use `{ output: process.stderr }` so prompts don't contaminate stdout.
- Git and subprocess spawns use explicit `cwd` rather than inheriting the process working directory.
- Validation errors surface before interactive prompts, not after the user has already answered questions.
- Non-TTY mode works correctly: no interactive prompts without `--yes`, no ANSI codes in piped output.

### 7. Spelling, grammar, and wording

Check all user-facing strings across the codebase:

- Help text, error messages, warning messages, success messages, summary lines.
- README.md and docs/.
- Consistent terminology (the terms defined in GUIDELINES.md — workspace vs worktree, upstream vs share, base vs share, etc.).

### 8. Code hygiene

- No `TODO`, `FIXME`, `HACK`, or `XXX` comments that should be resolved before release.
- No unused exports or dead code paths.
- No `as any` casts or type safety workarounds that could hide bugs.
- No `console.log` / `console.error` — all output should go through `output.ts`.
- Imports are clean (no unused imports — Biome should catch this, but verify).
- No stale internal names from past renames (variable names, function names, comments referencing old command names or terminology).
- Status model integrity: every `RepoFlags` property appears in `FLAG_LABELS`, and every flag in a named set (`AT_RISK_FLAGS`, `LOSE_WORK_FLAGS`, `STALE_FLAGS`) exists in `RepoFlags`.

### 9. Test coverage

- Run `bun test --coverage` but do not include the output. Just use it to identify areas of improvement. Flag modules with non-trivial logic below 50% line coverage.
- Identify commands that lack integration tests in `test/integration/`.
- Check that error paths and edge cases have test coverage, not just happy paths.
- Don't write new tests — just report gaps.

### 10. Build and distribution

- `install.sh` references correct paths and URLs.
- `package.json` scripts are all functional and documented in CLAUDE.md.
- The `set-version.ts` build script works correctly.
- `.github/workflows/check.yml` runs all necessary checks.
- `lefthook.yml` pre-commit hooks match the current tooling.

### 11. README quality

Read the README as a potential user would:

- Is it interesting and easy to understand?
- Does it highlight capabilities that pique interest without drowning in detail?
- Does the narrative flow naturally, or does it narrate the obvious?
- Are there repeated statements or unnecessary explanations?
- Do the code examples tell a coherent story?

### 12. Decision record compliance

Scan the `decisions/` directory for constraints that apply to current code. Verify they haven't drifted.