# Optional --branch value for interactive branch picker

Date: 2026-03-28

## Context

`arb create --branch <name>` requires an explicit branch name. Users sometimes know they want to base a workspace on an existing remote branch but don't remember the exact name. Bare `arb create` already offers an interactive branch picker, but it prompts for the workspace name first — the user wants the reverse: pick a branch, then derive the workspace name from it. The question is how to signal "I want the branch picker, but I'll choose interactively" within the existing CLI surface.

## Options

### Commander optional value — change `<branch>` to `[branch]`

Change the option from `-b, --branch <branch>` (required value) to `-b, --branch [branch]` (optional value). When the flag is present without a value, Commander sets the option to `true` instead of a string. This sentinel triggers the interactive branch picker flow.

- **Pros:** Natural syntax (`arb create --branch`), no new flags, reuses the existing `-b` short form, all existing `--branch <value>` behavior is unchanged.
- **Cons:** `arb create --branch repo-a` parses `repo-a` as the branch value (not a positional repo). However, this is already the current behavior with required value — no regression. No existing option in the codebase uses optional value syntax, making this the first instance.

### Separate boolean flag (`--pick-branch`)

Add a new flag that triggers the branch picker. Keep `--branch <branch>` as a required-value option.

- **Pros:** No parsing ambiguity at all.
- **Cons:** Adds a new flag for a concept already expressed by `--branch`. Requires short flag allocation or goes long-only. Two flags for the same concept feels redundant and violates the GUIDELINES.md preference for minimal flag proliferation.

## Decision

Use Commander optional value (`[branch]`).

## Reasoning

The syntax matches the user's mental model: "I want a branch, I just don't know which one yet." It reuses the existing flag without proliferation and fits Commander v14's explicit support for optional option arguments. The only parsing edge case (non-flag tokens after `--branch` being consumed as the value) already exists in the current required-value form, so there is no regression. Users wanting bare `--branch` with positional repos write `arb create myws repo-a --branch` (flag at end) or use `--all-repos`.

## Consequences

`--branch` now has three states: absent (`undefined`), bare flag (`true`), or string value. All code that reads `options.branch` as a string must use `typeof options.branch === "string"` instead of truthiness checks. Non-interactive mode (piped, CI) and `--yes` both reject bare `--branch` with clear error messages. This is the first optional-value option in the codebase — if the pattern proves clean, it could be reused elsewhere (e.g. `--base` could theoretically do the same for base branch selection).
