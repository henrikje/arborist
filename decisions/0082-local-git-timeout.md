# Local Git Timeout

Date: 2026-03-17

## Context

When arborist workspaces live on Dropbox (or iCloud, etc.), cloud-synced files that aren't fully downloaded locally cause `git status --porcelain` and other git commands to hang indefinitely. The OS blocks on reading "cloud placeholder" files. This makes `arb list`, `arb status`, and any command that calls `git()` completely unresponsive — including Ctrl-C, since Bun doesn't propagate SIGINT to child processes.

The root cause is that Dropbox shows a "cloud with arrow" icon for directories still downloading, and git blocks waiting for file content that hasn't synced yet. There's no way to detect this state before spawning git, and no git flag to set a timeout.

## Options

### Timeout on all local git calls
Add a default timeout (5s) to every `git()` call. Race `proc.exited` against a timer, kill on timeout, return exit code 124. Surface timed-out repos in the UI as an at-risk flag.
- **Pros:** Protects against all cloud-sync hangs. Simple mental model (local calls always finish). Ctrl-C works because the SIGINT handler can kill tracked processes.
- **Cons:** Adds a timer to every git call, including fast ones. Risk of false positives on slow filesystems or large repos.

### Per-command opt-in timeout
Only add timeouts to commands known to hang (status, list). Other commands keep bare `git()`.
- **Pros:** Smaller blast radius.
- **Cons:** Easy to miss callsites. New commands would need to remember to opt in. Inconsistent behavior.

### Detect cloud state before spawning git
Check extended file attributes or Dropbox API to skip repos that aren't fully synced.
- **Pros:** No false positives.
- **Cons:** Platform-specific (macOS xattrs, Windows Cloud Files API). Dropbox doesn't document these attributes reliably. Doesn't protect against other causes of git hangs.

## Decision

Timeout on all local git calls, with `ARB_GIT_TIMEOUT` env var to configure (default 5s, `0` disables). Rename `git()` → `gitLocal()` and `gitWithTimeout()` → `gitNetwork()` to make the local-vs-network distinction explicit.

## Reasoning

A 5-second default is generous — no legitimate local git operation (including patch-id with 200 commits) takes this long on a healthy filesystem. The rename makes it impossible to accidentally use the wrong function. `gitNetwork()` already had its own timeout mechanism via `networkTimeout()`; the rename just clarifies the intent.

Tracking active processes in a `Set` and killing them on SIGINT solves the Bun SIGINT propagation gap. The `isTimedOut` flag flows through the existing flag/render pipeline automatically, so timed-out repos appear in status tables and are filterable via `--where timed-out`.

## Consequences

- Every local git call pays for a `setTimeout` + `Promise.race`. In practice this is negligible compared to the git process itself.
- `ARB_GIT_TIMEOUT=0` is the escape hatch for users who need no timeout (e.g. NFS with high latency but no cloud sync).
- `Bun.$` piped commands (patch-id) can't be killed cleanly — on timeout the shell processes linger until arb exits. Acceptable because the user will exit shortly after seeing timeouts.
- The `timed-out` where filter lets users script around timeouts: `arb status --where ^timed-out` to see only healthy repos.
