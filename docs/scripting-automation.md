# Scripting & automation

## Non-interactive mode

Pass `--yes` (`-y`) to skip confirmation prompts on `push`, `pull`, `rebase`, `merge`, `reset`, `rename`, `branch rename`, `delete`, and `detach`. Without this flag, non-TTY environments (pipes, CI) exit with an error instead of hanging on a prompt:

```bash
arb rebase --yes && arb push --yes
```

## Dry run

Use `--dry-run` (`-n`) to preview what a command would do without executing it. The command runs its normal fetch and assessment phases, displays the plan, then exits cleanly:

```bash
arb push --dry-run        # see what would be pushed
arb push --yes            # looks good — go ahead
```

This is especially useful in scripted or AI-driven workflows where you want to inspect the plan before committing to it. The flag works on `push`, `pull`, `rebase`, `merge`, `reset`, `rename`, `branch rename`, `delete`, and `detach`.

## Filtering

Use `--where` (`-w`) to limit commands to repos matching specific conditions.

Comma-separated terms use **OR** logic — a repo matches if it satisfies _any_ term:

```bash
arb status --where dirty,unpushed       # repos that are dirty OR unpushed
arb list --where stale                  # workspaces with stale repos
```

Use `+` for **AND** — a repo must satisfy _all_ terms in the group:

```bash
arb exec --where dirty+unpushed git stash   # only repos that are both dirty AND unpushed
arb status --where dirty+behind-base        # dirty repos that also need rebasing
```

`+` binds tighter than `,`, so you can mix both:

```bash
arb status --where dirty+unpushed,gone      # (dirty AND unpushed) OR gone
arb delete --all-safe --where gone          # batch-remove workspaces whose branches are gone
```

For workspace-level commands (`list`, `delete`), AND applies per-repo: a workspace matches `dirty+unpushed` only if a _single_ repo is both dirty and unpushed, not if one repo is dirty and a different repo is unpushed.

`--where` is supported on `status`, `exec`, `open`, `diff`, `log`, `list`, `delete`, `push`, `pull`, `rebase`, `merge`, and `reset`. On `status`, `exec`, `open`, `diff`, `log`, and `list`, the shorthand `--dirty` (`-d`) is equivalent to `--where dirty`.

The full list of filter terms:

| Term | Matches repos where… |
|------|----------------------|
| `dirty` | there are uncommitted changes (staged, modified, untracked, or conflicting files) |
| `unpushed` | local commits haven't been pushed to the share remote |
| `not-pushed` | the branch has never been pushed to the share remote |
| `behind-share` | the share remote has commits not yet pulled |
| `behind-base` | the base branch has moved ahead (repo needs rebase/merge) |
| `diverged` | the base branch and local branch have diverged (both ahead and behind) |
| `wrong-branch` | the repo is on a different branch than the workspace expects |
| `detached` | the repo is in detached HEAD state |
| `operation` | a git operation is in progress (rebase, merge, cherry-pick, etc.) |
| `gone` | the tracking branch has been deleted from the remote |
| `shallow` | the clone is shallow |
| `merged` | the feature branch has been merged into the base branch |
| `base-merged` | the configured base branch has been merged into the default branch |
| `base-missing` | the configured base branch no longer exists (fell back to default) |
| `at-risk` | the repo has unpushed commits, local changes, or is in a dirty operation state |
| `stale` | the repo needs pulling, rebasing, or has diverged from base |
| `clean` | no uncommitted changes (inverse of `dirty`) |
| `pushed` | all commits pushed and branch exists on the share remote |
| `synced-base` | up to date with the base branch (not behind-base or diverged) |
| `synced-share` | up to date with the share remote (not behind-share) |
| `synced` | up to date with both base and share |
| `safe` | no at-risk flags and not stale — safe to delete |

Prefix any term with `^` to negate it: `^behind-base` matches repos that are _not_ behind the base branch. Negation works with composites too: `^at-risk` matches repos without any at-risk flags.

## Quiet output

Use `-q` / `--quiet` for plain enumeration — one name per line on stdout, no headers, no colors:

```bash
arb list -q                          # all workspace names
arb status -q                        # all repo names in current workspace
arb repo list -q                     # all canonical repo names
```

Combine with `--where` for filtered enumeration:

```bash
arb list -q --where gone             # workspaces with gone repos
arb status -q --where dirty          # only dirty repo names
```

## Parallel execution

Use `arb exec --parallel` (`-p`) to run commands concurrently across all repos:

```bash
arb exec -p npm install           # install dependencies in all repos simultaneously
arb exec -p make build            # parallel builds
arb exec -p -- git diff --stat    # parallel git operations
```

Output is buffered per repo and printed in consistent alphabetical order. Stdin is disabled in parallel mode — interactive commands will not work. Combine with `--where` or `--dirty` to narrow the scope:

```bash
arb exec -p --dirty npm test      # test only dirty repos, in parallel
arb exec -p --repo api --repo web -- npm test
```

## Stdin piping

Commands that accept `[repos...]` or `[names...]` also read names from stdin when piped. Positional args take precedence over stdin, and stdin takes precedence over the default (all).

```bash
arb status -q --where dirty | arb exec git stash  # stash only dirty repos (exec doesn't read stdin)
arb status -q --where unpushed | arb diff         # diff only unpushed repos
arb list -q --where gone | arb delete -y          # delete gone workspaces
arb status -q | grep -v legacy | arb rebase -y    # rebase all except "legacy"
```

Since `push`, `pull`, `rebase`, and `merge` now support `--where` natively, prefer the direct flag over piping:

```bash
arb push --where ^behind-base -y      # only push repos that are already rebased
arb rebase --where ^diverged -y       # skip diverged repos, rebase the easy ones
```

Stdin-accepting commands: `create`, `attach`, `detach`, `status`, `diff`, `log`, `push`, `pull`, `rebase`, `merge`, `reset`, `delete`.

`exec` and `open` are excluded because they inherit stdin for child processes. Use xargs instead:

```bash
arb status -q --where dirty | xargs -I{} arb exec --repo {} make test
```

## Machine-readable output

Six commands support `--json` for structured output to stdout:

| Command | Output shape |
|---------|-------------|
| `arb status --json` | Object with `workspace`, `branch`, `base`, `repos[]`, aggregates |
| `arb list --json` | Array of workspace objects with status counts and labels |
| `arb log --json` | Object with `workspace`, `branch`, `base`, `repos[]`, `totalCommits` |
| `arb diff --json` | Object with `workspace`, `branch`, `base`, `repos[]`, file/line totals |
| `arb branch --json` | Object with `branch`, `base`, per-repo branches |
| `arb repo list --json` | Array of repo entries with remote role detail |

Use `--schema` on any of these commands to print the JSON Schema describing the output shape. This works without being inside a workspace — it's pure schema introspection:

```bash
arb status --schema | jq .          # inspect the full JSON Schema
arb branch --schema > schema.json   # save schema to file
```

Examples:

```bash
arb list --json | jq '[.[] | select(.active)]'
arb list --json --no-status | jq '.[].workspace'
arb status --json | jq '[.repos[] | select(.base.behind > 0) | .name]'
arb repo list --json | jq '.[].name'
```

Add `--verbose` to `arb status --json` for file-level detail — staged files, modified files, untracked files, and the individual commits that are ahead or behind:

```bash
arb status --json --verbose | jq '[.repos[] | select(.verbose.unstaged | length > 0)]'
```

JSON output includes detected PR numbers when available:

```bash
# Get detected PR URLs for merged repos
arb status --json | jq '[.repos[] | select(.base.detectedPr) | {name, pr: .base.detectedPr}]'
```

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ARB_NETWORK_TIMEOUT` | Global timeout for all network operations (seconds). Overridden by operation-specific variables when set. | per-operation default |
| `ARB_FETCH_TIMEOUT` | Timeout for fetch operations (seconds) | `120` |
| `ARB_PUSH_TIMEOUT` | Timeout for push operations (seconds) | `120` |
| `ARB_PULL_TIMEOUT` | Timeout for pull operations (seconds) | `120` |
| `ARB_CLONE_TIMEOUT` | Timeout for clone operations (seconds) | `300` |
| `ARB_DEBUG` | Enable debug output when set to `1` | off |
| `ARB_NO_UPDATE_CHECK` | Disable the automatic update check when set to `1` | off |
| `COLUMNS` | Override terminal width for table and graph rendering | auto-detected |

Timeout resolution order: operation-specific variable → `ARB_NETWORK_TIMEOUT` → built-in default. Exit code `124` indicates a timeout (matching the Unix `timeout` convention).

## Exit codes

`0` means success, `1` means failure, `130` means the user aborted a confirmation prompt.

## Output separation

Human-facing output (progress, prompts, summaries) goes to stderr. Machine-parseable data (`--json`, `arb path`) goes to stdout. Colors are stripped automatically in non-TTY environments.
