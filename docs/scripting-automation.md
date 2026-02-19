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

## Machine-readable output

`arb list --json` writes a JSON array of workspace objects to stdout with aggregate issue counts, labels (`withIssues`, `issueLabels`), and last commit date (`lastCommit` as ISO 8601). Combine with `--quick` to skip status gathering:

```bash
arb list --json | jq '[.[] | select(.active)]'
arb list --json --quick | jq '.[].workspace'
```

`arb status --json` writes structured JSON to stdout. Each repo includes branch state, base branch drift, remote push/pull status, local changes, and any in-progress operation:

```bash
arb status --json | jq '[.repos[] | select(.base.behind > 0) | .name]'
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
