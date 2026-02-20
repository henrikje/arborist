# Scripting & automation

## Non-interactive mode

Pass `--yes` (`-y`) to skip confirmation prompts on `push`, `pull`, `rebase`, `merge`, and `remove`. For `push` and `remove`, `--force` (`-f`) implies `--yes`. Without these flags, non-TTY environments (pipes, CI) exit with an error instead of hanging on a prompt:

```bash
arb rebase --yes && arb push --force
```

## Dry run

Use `--dry-run` (`-n`) to preview what a command would do without executing it. The command runs its normal fetch and assessment phases, displays the plan, then exits cleanly:

```bash
arb push --dry-run        # see what would be pushed
arb push --yes            # looks good — go ahead
```

This is especially useful in scripted or AI-driven workflows where you want to inspect the plan before committing to it. The flag works on `push`, `pull`, `rebase`, `merge`, and `remove`.

## Filtering

Use `--where` (`-w`) to limit commands to repos matching specific conditions. Multiple terms can be comma-separated and are combined with OR logic — a repo is included if it matches _any_ of the listed terms.

```bash
arb status --where dirty                # repos with uncommitted changes
arb exec --where unpushed git stash     # run a command only in repos with unpushed commits
arb remove --all-safe --where gone      # batch-remove workspaces whose branches are gone from the remote
arb list --where stale                  # workspaces with stale repos
```

`--where` is supported on `status`, `exec`, `open`, `list`, and `remove`. On `exec` and `open`, the shorthand `--dirty` (`-d`) is equivalent to `--where dirty`.

The full list of filter terms:

| Term | Matches repos where… |
|------|----------------------|
| `dirty` | there are uncommitted changes (staged, modified, or untracked files) |
| `unpushed` | local commits haven't been pushed to the share remote |
| `behind-share` | the share remote has commits not yet pulled |
| `behind-base` | the base branch has moved ahead (repo needs rebase/merge) |
| `diverged` | the share remote and local branch have diverged |
| `drifted` | the worktree is on a different branch than the workspace expects |
| `detached` | the worktree is in detached HEAD state |
| `operation` | a git operation is in progress (rebase, merge, cherry-pick, etc.) |
| `local` | the repo has no remote (local-only) |
| `gone` | the tracking branch has been deleted from the remote |
| `shallow` | the clone is shallow |
| `merged` | the feature branch has been merged into the base branch |
| `base-merged` | the configured base branch has been merged into the default branch |
| `base-missing` | the configured base branch no longer exists (fell back to default) |
| `at-risk` | the repo has unpushed commits, local changes, or is in a dirty operation state |
| `stale` | the repo matches any staleness condition (at-risk, operation, drifted, etc.) |

## Machine-readable output

`arb list --json` writes a JSON array of workspace objects to stdout with aggregate status counts, labels (`atRiskCount`, `statusLabels`), and last commit date (`lastCommit` as ISO 8601). Combine with `--quick` to skip status gathering:

```bash
arb list --json | jq '[.[] | select(.active)]'
arb list --json --quick | jq '.[].workspace'
```

`arb status --json` writes structured JSON to stdout. Each repo includes branch state, base branch drift, remote push/pull status, local changes, and any in-progress operation:

```bash
arb status --json | jq '[.repos[] | select(.base.behind > 0) | .name]'
```

Add `--verbose` for file-level detail — staged files, modified files, untracked files, and the individual commits that are ahead or behind:

```bash
arb status --json --verbose | jq '[.repos[] | select(.verbose.unstaged | length > 0)]'
```

## Exit codes

`0` means success, `1` means failure or issues detected, `130` means the user aborted a confirmation prompt. `arb status` returns `1` when any repo has issues, making it useful as a health check:

```bash
if arb -C my-feature status > /dev/null; then
  echo "all clean"
fi
```

## Output separation

Human-facing output (progress, prompts, summaries) goes to stderr. Machine-parseable data (`--json`, `arb path`) goes to stdout. Colors are stripped automatically in non-TTY environments.
