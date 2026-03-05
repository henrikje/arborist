# 0059 — Adaptive `arb create` flow

Date: 2026-03-05

## Context

`arb create` had grown a flexible but hard-to-predict interaction model. In TTY sessions it often asked for branch and base even in common "everyday" cases like `arb create my-feature`, while still supporting non-interactive usage and explicit flags.

Two recurring user pain points emerged: accidental pasting of a branch name as workspace name (`arb create foo/bar`) and repeated base-branch prompts even though most workspaces use the repo default branch.

We needed a coherent model that keeps full guidance available for exploratory usage, but keeps frequent paths fast and deterministic.

## Options

### Keep branch/base prompts in TTY whenever `--branch` is not set

Preserve current behavior of prompting in interactive sessions, including for partially specified commands.

- **Pros:** Existing interactive discovery remains unchanged.
- **Cons:** Everyday commands stay noisy and less predictable. Optional data behaves like required input.

### Adaptive flow based on explicit user input

Treat bare `arb create` as guided mode, but when the user provides args/flags, prompt only for missing required fields and use defaults for optional fields.

- **Pros:** Predictable, fast common path. Keeps guided mode available without adding new command surface.
- **Cons:** Existing-branch discovery via selector is now concentrated in bare `arb create`.

### Add a separate `--interactive` switch

Default to streamlined behavior and require an explicit flag to enter guided mode.

- **Pros:** Explicit and script-friendly.
- **Cons:** Adds surface area for a behavior that already has a natural trigger (`arb create` with no args).

## Decision

Choose the adaptive flow:

- Bare `arb create` (no args/flags) runs guided prompts for name, repos, and branch.
- Non-bare invocations prompt only for missing required fields.
- Base branch becomes flag-only (`--base`), with no interactive prompt.
- `arb create --branch <branch>` without name derives workspace name from the branch tail (after the last `/`).
- Invalid slash-containing workspace names that look like branches show a targeted `--branch` hint.

## Reasoning

This follows GUIDELINES.md principles for clarity and "do one thing well": explicit user input should reduce questions, not trigger more optional prompts. The branch default (`workspace name`) already exists and is safe; keeping it as the streamlined default makes `arb create <name>` predictable.

Keeping bare `arb create` as the guided path preserves discoverability of existing branches without introducing a new flag. Making base explicit via `--base` matches actual usage frequency and removes repetitive low-value prompts.

Branch-paste hints apply the "detect, warn, and protect" principle: reject invalid workspace names safely, then provide a concrete recovery command instead of forcing trial-and-error.

## Consequences

- `arb create <name>` in TTY now asks for repos only; it does not prompt for branch/base.
- Branch selector fetch runs only in guided mode, reducing unnecessary fetch overhead in streamlined mode.
- `arb create --branch <branch>` can create a workspace without an explicit name; if the derived name is invalid or taken, arb fails with guidance to provide an explicit workspace name.
- The slash-name branch hint improves error recovery while avoiding silent intent rewriting.
