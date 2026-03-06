# 0060 — `arb create` info lines and guided-mode scope

Date: 2026-03-06

## Context

After the adaptive create flow (0059), non-bare invocations like `arb create my-ws` silently defaulted branch and base without telling the user what values were chosen. This made the command fast but opaque — the user couldn't confirm what was about to happen without inspecting the resulting workspace.

A second issue surfaced: the guided-mode gate (`isBareGuidedCreate`) excluded invocations with `--base` or `--all-repos`, even when name and branch were unset. This meant `arb create --base develop` prompted for a workspace name but then silently defaulted the branch — an inconsistent experience where providing one optional flag unexpectedly suppressed the branch selector.

## Options

### Print info lines for all resolved values

After resolving workspace name, branch, base, and repos, print a confirmation block showing each value with a hint when it was defaulted (e.g. "same as workspace, use --branch to override"). Skip the block entirely in guided mode where the user is choosing everything interactively.

- **Pros:** Every non-interactive value is visible. Override hints teach discoverability.
- **Cons:** Adds output lines to every non-bare create.

### Print only when values are defaulted

Show info lines only for values the user didn't explicitly provide.

- **Pros:** Less output for fully explicit commands.
- **Cons:** Inconsistent — sometimes you see lines, sometimes you don't. Harder to scan when mixing explicit and defaulted values.

### Widen guided-mode gate to check only name and branch

Change `isBareGuidedCreate` from requiring all flags absent to requiring only `!nameArg && !options.branch`. Flags like `--base` and `--all-repos` preset values within the guided flow rather than disqualifying it.

- **Pros:** `arb create --base develop` gets the full interactive experience (name prompt, branch selector, repo picker) with base preset. Consistent: providing optional metadata doesn't suppress required prompts.
- **Cons:** Slightly different from 0059's original definition of "bare" as zero args/flags.

### Keep guided-mode gate strict

Require all flags absent for guided mode. Partial flags get streamlined defaults.

- **Pros:** Simple rule: any flag means streamlined.
- **Cons:** `arb create --base x` silently defaults branch — surprising when the user clearly intended an interactive session.

## Decision

Print info lines for all resolved values (option 1) and widen the guided-mode gate (option 3).

Info lines use a `›` chevron prefix with the value in cyan. When a value was defaulted, an override hint is appended in plain text. When the workspace name was just prompted for interactively, the Workspace line is suppressed to avoid redundancy.

Guided mode now triggers when no name argument and no `--branch` flag are provided, regardless of `--base` or `--all-repos`.

## Reasoning

Printing all values follows the GUIDELINES.md principle of clear, descriptive output — the user should see what arb is about to do. Showing both explicit and defaulted values keeps the block scannable and consistent across invocations.

Widening the guided gate follows the principle that explicit user input should reduce questions. `--base` and `--all-repos` answer specific questions (which base, which repos) but don't answer the primary questions (what name, which branch). Suppressing the branch selector because the user set a base branch violates user expectations — providing more information should not yield less guidance.

## Consequences

- Every non-guided `arb create` prints 3-4 info lines to stderr before proceeding. This is new output that scripts parsing stderr should tolerate.
- `arb create --base x` and `arb create -a` now enter guided mode (name prompt, branch selector) instead of silently defaulting the branch. This is a behavior change from 0059's original gate.
- The `›` chevron prefix establishes a visual pattern for confirmation output that could be reused in other commands.
- Prompt labels are aligned: "Workspace:", "Branch:", "Repos:" across both interactive prompts and info lines.
