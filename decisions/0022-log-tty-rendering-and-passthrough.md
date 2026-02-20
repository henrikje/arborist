# Log TTY Rendering and Flag Passthrough

Date: 2026-02-20

## Context

`arb log` shows feature branch commits across repos. It needs three output modes: TTY (human reading a terminal), pipe (tab-separated for scripting), and JSON (structured). The TTY mode initially used custom rendering — indented commit lines with dimmed hashes — but the output felt disconnected from git's familiar `--oneline` format that developers already know.

This raised two follow-up questions: should the TTY path delegate to `git log` directly, and if so, should `arb log` pass through arbitrary flags to the underlying git call?

## Options

### Custom rendering (original)
Fetch structured commit data, render with custom formatting (indented lines, dimmed hashes, commit count in header).
- **Pros:** Full control over output, consistent across all modes.
- **Cons:** Unfamiliar format, misses git features like decorations and colors, more code to maintain.

### Delegate to git for TTY, structured for pipe/JSON
Branch early in the action handler. TTY mode runs `git log --oneline --color=always` and writes its output to stdout. Pipe and JSON modes still gather structured data.
- **Pros:** Familiar output, less rendering code, git handles colors and formatting.
- **Cons:** TTY and non-TTY paths diverge, status-resolution logic duplicated.

### Delegate to git with flag passthrough
Same as above, but accept arbitrary flags after `--` and forward them to the git log call.
- **Pros:** Full power of git log (--graph, --since, --author) with workspace-aware base..HEAD scoping.
- **Cons:** Flags silently ignored in pipe/JSON modes. Establishes a `--` convention that doesn't scale to other commands (status, rebase, push) where arb's orchestration layer would conflict with raw git flags.

## Decision

Delegate TTY rendering to git with `--oneline --no-decorate --color=always`. Do not pass through flags. Use `--no-decorate` explicitly to suppress branch annotations that would redundantly repeat the workspace branch name on every repo's first commit.

## Reasoning

The TTY output is a display concern — git already formats oneline logs well, with colors and layout that developers expect. Reimplementing this adds code without adding value. Delegating to git aligns with the "align with Git" principle in GUIDELINES.md.

Flag passthrough was rejected because `arb log` is the only command where it would work cleanly (being read-only and display-focused). Commands like `rebase`, `push`, and `status` add orchestration, safety checks, and multi-repo coordination that raw git flags could undermine. Establishing a `--` convention for one command sets a precedent the rest of the CLI can't follow. For advanced git log usage, `arb exec git log` already exists.

`--no-decorate` overrides any user git config (`log.decorate=auto`). In a multi-repo workspace, every repo's first commit would show `(HEAD -> feature-branch)` — the same branch name repeated N times. The workspace context already establishes which branch you're on, so decorations are noise rather than signal.

## Consequences

- TTY output matches what developers see from `git log --oneline`, minus decorations.
- Pipe and JSON modes are unaffected — they use structured data with a fixed format.
- Users who want `--graph`, `--since`, or other git log features must use `arb exec git log`.
- If demand emerges for a specific git log feature (e.g. `--graph`), it can be added as a dedicated `arb log` flag that maps to the right behavior across all output modes, rather than as raw passthrough.
