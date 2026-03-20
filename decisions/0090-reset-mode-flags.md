# Reset Mode Flags (--soft, --mixed, --hard)

Date: 2026-03-20

## Context

`arb reset` always performed `git reset --hard`, discarding all local changes (staged, unstaged, and commits). Git's `reset` supports three modes — `--soft` (move HEAD only), `--mixed` (reset HEAD and index, preserve working tree), and `--hard` (reset everything) — with `--mixed` as the default. Adding these modes to `arb reset` would align with Git's interface while preserving the command's core coordination value: automatic per-repo target resolution, plan display, and confirmation flow.

The question had two parts: (1) whether to add mode flags at all, and (2) what the default should be.

## Options

### Add --soft, --mixed, --hard with --hard as default
Preserves current behavior for bare `arb reset`. Non-destructive modes are opt-in.
- **Pros:** Backward-compatible, no existing workflow changes
- **Cons:** Diverges from Git's default (`--mixed`), destructive mode as default conflicts with safety-first principle

### Add --soft, --mixed, --hard with --mixed as default
Matches Git's default. Destructive mode requires explicit `--hard`.
- **Pros:** Git alignment, safety-first (safer default), pre-release is the right time to change defaults
- **Cons:** Changes existing behavior — bare `arb reset` no longer discards working tree

### No flags — reset stays hard-only
Soft/mixed resets handled via `arb exec -- git reset --soft <target>`.
- **Pros:** Simplicity, "do one thing well"
- **Cons:** Misses Git alignment, loses coordination value (target resolution) for soft/mixed use cases

## Decision

Add all three mode flags with `--mixed` as the default, matching Git.

## Reasoning

Three GUIDELINES principles converge on this choice. "Align with Git" says developers who know Git should feel at home — `git reset` defaults to `--mixed`, so `arb reset` should too. "Safety first" says when a choice exists between power and safety, safety wins — `--mixed` is strictly safer than `--hard` since it preserves the working tree. "Prefer correctness over backwards compatibility" during pre-release means this is the right time to get the default right rather than preserving an overly-destructive default.

The coordination value of `arb reset` (per-repo target resolution, plan/confirm flow) applies equally to all three modes. The GUIDELINES "evaluating new operations" framework classifies this as a "variant of an existing operation" — the mechanism is the same, only the preservation behavior differs — which belongs as a flag on the existing command.

## Consequences

Bare `arb reset` no longer discards the working tree. Users who want full cleanup must pass `--hard` explicitly. The plan display adapts to the mode: `--hard` shows "discard" language with data-loss warnings, while `--soft`/`--mixed` show non-destructive "become staged"/"become unstaged" language. The unpushed-commit warning ("permanently lost") only appears for `--hard`. Existing scripts using bare `arb reset` for cleanup should add `--hard` to preserve behavior.
