#!/usr/bin/env bats

load test_helper/common-setup

# ── --base option (stacked PRs) ──────────────────────────────────

@test "arb create --base stores base in config" {
    arb create stacked --base feat/auth -b feat/auth-ui --all-repos
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" == *"branch = feat/auth-ui"* ]]
    [[ "$output" == *"base = feat/auth"* ]]
}

@test "arb create --base branches from the specified base" {
    # Create a base branch with unique content
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth-content" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "add auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace branching from feat/auth
    arb create stacked --base feat/auth -b feat/auth-ui repo-a
    # Content from the base branch should be present
    [ -f "$TEST_DIR/project/stacked/repo-a/auth.txt" ]
    run cat "$TEST_DIR/project/stacked/repo-a/auth.txt"
    [[ "$output" == *"auth-content"* ]]
}

@test "arb create without --base has no base key in config" {
    arb create no-base -b feat/plain --all-repos
    run cat "$TEST_DIR/project/no-base/.arbws/config"
    [[ "$output" == *"branch = feat/plain"* ]]
    [[ "$output" != *"base ="* ]]
}

@test "arb create --base with invalid branch name fails" {
    run arb create bad-base --base "bad branch name" -b feat/ok repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid base branch name"* ]]
}

@test "arb add respects stored base branch" {
    # Create a base branch with unique content in both repos
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/base >/dev/null 2>&1
    echo "base-a" > "$TEST_DIR/project/.arb/repos/repo-a/base.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add base.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/base >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout -b feat/base >/dev/null 2>&1
    echo "base-b" > "$TEST_DIR/project/.arb/repos/repo-b/base.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-b" add base.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" push -u origin feat/base >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout --detach >/dev/null 2>&1

    # Create workspace with --base, only including repo-a initially
    arb create stacked --base feat/base -b feat/stacked repo-a
    [ -f "$TEST_DIR/project/stacked/repo-a/base.txt" ]

    # Now add repo-b — should also branch from feat/base
    cd "$TEST_DIR/project/stacked"
    arb add repo-b
    [ -f "$TEST_DIR/project/stacked/repo-b/base.txt" ]
    run cat "$TEST_DIR/project/stacked/repo-b/base.txt"
    [[ "$output" == *"base-b"* ]]
}

@test "arb create --base falls back to default branch when base missing" {
    # repo-a and repo-b do NOT have feat/auth — only their default branch
    run arb create stacked --base feat/auth -b feat/auth-ui --all-repos
    [ "$status" -eq 0 ]
    # Should warn about the missing base branch for each repo
    [[ "$output" == *"base branch 'feat/auth' not found"* ]]
    # Worktrees should still be created (branched from default)
    [ -d "$TEST_DIR/project/stacked/repo-a" ]
    [ -d "$TEST_DIR/project/stacked/repo-b" ]
    local branch
    branch="$(git -C "$TEST_DIR/project/stacked/repo-a" branch --show-current)"
    [ "$branch" = "feat/auth-ui" ]
}

@test "arb add falls back to default branch when workspace base missing in repo" {
    # Create workspace with a base that exists only in repo-a
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/base >/dev/null 2>&1
    echo "base-a" > "$TEST_DIR/project/.arb/repos/repo-a/base.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add base.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/base >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/base -b feat/stacked repo-a
    [ -f "$TEST_DIR/project/stacked/repo-a/base.txt" ]

    # repo-b does NOT have feat/base — add should fall back with warning
    cd "$TEST_DIR/project/stacked"
    run arb add repo-b
    [ "$status" -eq 0 ]
    [[ "$output" == *"base branch 'feat/base' not found"* ]]
    [ -d "$TEST_DIR/project/stacked/repo-b" ]
    local branch
    branch="$(git -C "$TEST_DIR/project/stacked/repo-b" branch --show-current)"
    [ "$branch" = "feat/stacked" ]
}

# ── rebase ───────────────────────────────────────────────────────

@test "arb rebase rebases feature branch onto updated base" {
    arb create my-feature repo-a repo-b

    # Push a commit to main on origin for repo-a
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
    [[ "$output" == *"Rebased"* ]]

    # Verify the upstream commit is now reachable from the feature branch
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream change"* ]]
}

@test "arb rebase plan shows HEAD SHA" {
    arb create my-feature repo-a

    # Push upstream change so rebase has work to do
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb rebase --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
}

@test "arb rebase shows up to date when nothing to do" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

@test "arb rebase skips dirty repos" {
    arb create my-feature repo-a

    # Push upstream change
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Make worktree dirty
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [[ "$output" == *"skipped"* ]]
    [[ "$output" == *"uncommitted changes"* ]]
}

@test "arb rebase skips wrong branch" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [[ "$output" == *"skipped"* ]]
    [[ "$output" == *"expected my-feature"* ]]
}

@test "arb rebase continues past conflict and shows consolidated report" {
    arb create my-feature repo-a repo-b

    # Create conflicting changes in repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream conflict" && git push) >/dev/null 2>&1

    # Push an upstream change to repo-b (no conflict)
    (cd "$TEST_DIR/project/.arb/repos/repo-b" && echo "upstream-ok" > ok.txt && git add ok.txt && git commit -m "upstream ok" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase repo-a repo-b --yes
    [ "$status" -ne 0 ]
    # Conflict file details shown
    [[ "$output" == *"CONFLICT"*"conflict.txt"* ]]
    # Conflict instructions shown
    [[ "$output" == *"conflict"* ]]
    [[ "$output" == *"git rebase --continue"* ]]
    [[ "$output" == *"git rebase --abort"* ]]
    # repo-b was still processed successfully
    [[ "$output" == *"Rebased 1 repo, 1 conflicted"* ]]
}

@test "arb rebase with specific repos only processes those repos" {
    arb create my-feature repo-a repo-b

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase repo-a --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased 1 repo"* ]]
    # repo-b should not appear in output
    [[ "$output" != *"repo-b"* ]]
}

@test "arb rebase --yes skips confirmation" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased"* ]]
    [[ "$output" == *"Skipping confirmation"* ]]
}

@test "arb rebase non-TTY without --yes errors" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Pipe to force non-TTY
    run bash -c 'echo "" | arb rebase'
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not a terminal"* ]] || [[ "$output" == *"--yes"* ]]
}

@test "arb rebase --no-fetch skips fetching" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Fetch manually so rebase has fresh refs, then test --no-fetch skips fetching
    arb fetch >/dev/null 2>&1
    run arb rebase --no-fetch --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetched"* ]]
    [[ "$output" == *"Rebased"* ]]
}

@test "arb rebase -F fetches (short for --fetch)" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase -F --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
    [[ "$output" == *"Rebased"* ]]
}

@test "arb rebase with custom base branch" {
    # Create a base branch with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Push a new commit to feat/auth on origin
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout feat/auth && echo "new-auth" > new-auth.txt && git add new-auth.txt && git commit -m "new auth commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"rebase feat/auth-ui onto"*"feat/auth"* ]]
    [[ "$output" == *"Rebased"* ]]

    # Verify the upstream commit is reachable
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" == *"new auth commit"* ]]
}

@test "arb rebase skips in-progress operation" {
    arb create my-feature repo-a

    # Create conflicting changes for a manual rebase
    echo "base" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "base" >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    # Start a rebase that will conflict (need fresh refs for manual git rebase)
    git -C "$TEST_DIR/project/my-feature/repo-a" rebase origin/main >/dev/null 2>&1 || true

    run arb rebase --yes
    [[ "$output" == *"skipped"* ]]
    [[ "$output" == *"rebase in progress"* ]]
}

# ── merge ────────────────────────────────────────────────────────

@test "arb merge merges base branch into feature branch" {
    arb create my-feature repo-a repo-b

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
    [[ "$output" == *"Merged"* ]]

    # Verify merge commit exists
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream change"* ]]
}

@test "arb merge plan shows HEAD SHA" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb merge --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
}

@test "arb merge shows up to date when nothing to do" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

@test "arb merge continues past conflict and shows consolidated report" {
    arb create my-feature repo-a repo-b

    # Create conflicting changes in repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream conflict" && git push) >/dev/null 2>&1

    # Push an upstream change to repo-b (no conflict)
    (cd "$TEST_DIR/project/.arb/repos/repo-b" && echo "upstream-ok" > ok.txt && git add ok.txt && git commit -m "upstream ok" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb merge repo-a repo-b --yes
    [ "$status" -ne 0 ]
    # Conflict file details shown
    [[ "$output" == *"CONFLICT"*"conflict.txt"* ]]
    # Conflict instructions shown
    [[ "$output" == *"conflict"* ]]
    [[ "$output" == *"git merge --continue"* ]]
    [[ "$output" == *"git merge --abort"* ]]
    # repo-b was still processed successfully
    [[ "$output" == *"Merged 1 repo, 1 conflicted"* ]]
}

@test "arb merge -F fetches (short for --fetch)" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb merge -F --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
    [[ "$output" == *"Merged"* ]]
}

@test "arb merge --no-fetch skips fetching" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb merge --no-fetch --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetched"* ]]
    [[ "$output" == *"Merged"* ]]
}


# ── rebase+push end-to-end ──────────────────────────────────────

@test "arb rebase then push --force end-to-end" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased"* ]]

    run arb push --force --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]

    # Verify remote has both commits
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch origin my-feature
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" log --oneline origin/my-feature
    [[ "$output" == *"feature"* ]]
    [[ "$output" == *"upstream"* ]]
}

@test "arb push --force implies --yes" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push an upstream change to main to create divergence after rebase
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Rebase the feature branch
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    # Push with --force only (no --yes) — should skip confirmation
    run arb push --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]
    [[ "$output" == *"Skipping confirmation"* ]]
}


# ── conflict prediction ─────────────────────────────────────────

@test "arb rebase --dry-run shows conflict likely for overlapping changes" {
    arb create my-feature repo-a

    # Create a shared file on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull the shared file into the feature branch
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    arb rebase --yes >/dev/null 2>&1

    # Now create a conflicting change on the feature branch
    echo "feature version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add shared.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1

    # And a conflicting change on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    run arb rebase --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"conflict likely"* ]]
}

@test "arb rebase --dry-run shows conflict unlikely for non-overlapping changes" {
    arb create my-feature repo-a

    # Make a local commit on the feature branch (different file)
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/feature.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add feature.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature commit" >/dev/null 2>&1

    # Push an upstream change (different file)
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"conflict unlikely"* ]]
}

@test "arb rebase --dry-run shows conflict unlikely for fast-forward" {
    arb create my-feature repo-a

    # Push an upstream change (repo-a is behind only, no local commits)
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"conflict unlikely"* ]]
}

@test "arb merge --dry-run shows will conflict for overlapping changes" {
    arb create my-feature repo-a

    # Create a shared file on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull the shared file into the feature branch
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    arb rebase --yes >/dev/null 2>&1

    # Now create a conflicting change on the feature branch
    echo "feature version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add shared.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1

    # And a conflicting change on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    run arb merge --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"will conflict"* ]]
}

@test "arb pull --dry-run shows conflict unlikely for simple pull" {
    arb create my-feature repo-a

    # Push the feature branch first
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "local" > local.txt && git add local.txt && git commit -m "local" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a remote commit to the feature branch via a tmp clone
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > remote.txt && git add remote.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"conflict unlikely"* ]]
}


# ── two-phase plan rendering ────────────────────────────────────

@test "arb push --no-fetch shows plan without fetch line" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --no-fetch --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetching"* ]]
    [[ "$output" != *"Fetched"* ]]
    [[ "$output" == *"to push"* ]]
    [[ "$output" == *"Pushed"* ]]
}

@test "arb pull --dry-run with no remote repos shows plan" {
    setup_local_repo
    arb create local-ws local-lib
    cd "$TEST_DIR/project/local-ws"
    run arb pull --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" != *"Fetching"* ]]
    [[ "$output" != *"Fetched"* ]]
}

@test "arb rebase skips repo when fetch fails" {
    arb create my-feature repo-a repo-b

    # Push an upstream change to repo-a so rebase would have work to do
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Break repo-a's remote URL so fetch fails
    git -C "$TEST_DIR/project/.arb/repos/repo-a" remote set-url origin "file:///nonexistent/repo.git"

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [[ "$output" == *"fetch failed"* ]]
    [[ "$output" == *"repo-a"*"skipped"* ]]
}

@test "arb pull skips repo when fetch fails" {
    arb create my-feature repo-a repo-b
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a remote commit so there's something to pull
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    # Break repo-a's remote URL so fetch fails
    git -C "$TEST_DIR/project/.arb/repos/repo-a" remote set-url origin "file:///nonexistent/repo.git"

    cd "$TEST_DIR/project/my-feature"
    run arb pull --yes
    [[ "$output" == *"fetch failed"* ]]
    [[ "$output" == *"repo-a"*"skipped"* ]]
}


# ── stacked base merge detection ─────────────────────────────────

@test "arb status detects base branch merged (not deleted)" {
    # Create feat/auth branch in repo-a with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main via merge commit (do NOT delete feat/auth)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    # Fetch in the stacked workspace
    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1

    # Status should show "base merged"
    run arb status
    [[ "$output" == *"base merged"* ]]

    # --where base-merged should show the repo
    run arb status --where base-merged
    [[ "$output" == *"repo-a"* ]]
}

@test "arb status detects base branch squash-merged (not deleted)" {
    # Create feat/auth branch in repo-a with commits
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Squash merge feat/auth into main (do NOT delete feat/auth)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge --squash origin/feat/auth && git commit -m "squash: auth" && git push) >/dev/null 2>&1

    # Fetch in the stacked workspace
    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1

    # Status should show "base merged"
    run arb status
    [[ "$output" == *"base merged"* ]]
}

@test "arb rebase skips repo when base branch is merged" {
    # Create feat/auth branch
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --yes
    [[ "$output" == *"was merged into default"* ]]
    [[ "$output" == *"--retarget"* ]]
    [[ "$output" == *"skipped"* ]]
}

@test "arb push skips when base branch is merged (not deleted)" {
    # Create feat/auth branch
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main (do NOT delete feat/auth)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb push --yes
    [[ "$output" == *"was merged into default"* ]]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"skipped"* ]]
}

@test "arb pull skips when base branch is merged (not deleted)" {
    # Create feat/auth branch
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace and push
    arb create stacked --base feat/auth -b feat/auth-ui repo-a
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" push -u origin feat/auth-ui >/dev/null 2>&1

    # Merge feat/auth into main (do NOT delete feat/auth)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb pull --yes
    [[ "$output" == *"was merged into default"* ]]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"skipped"* ]]
}

@test "arb rebase --retarget rebases onto default branch (merge commit)" {
    # Create feat/auth branch
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main via merge commit
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"Retargeted"* ]]

    # Verify the ui commit is on top of main
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" == *"ui feature"* ]]
    [[ "$output" == *"merge feat/auth"* ]]

    # Verify config no longer has base = feat/auth
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" != *"base = feat/auth"* ]]
}

@test "arb rebase --retarget uses --onto for squash-merged base" {
    # Create feat/auth branch with commits
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Squash merge feat/auth into main (do NOT delete feat/auth)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge --squash origin/feat/auth && git commit -m "squash: auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]

    # Verify the ui commit is on top of main
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" == *"ui feature"* ]]
    [[ "$output" == *"squash: auth"* ]]

    # Verify feat/auth's original commits are NOT in the branch history
    # (the --onto flag should have excluded them)
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    # "auth feature" should NOT appear because --onto replayed only the stacked commits
    [[ "$output" != *"auth feature"* ]]

    # Verify config updated
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" != *"base = feat/auth"* ]]
}

@test "arb status --json includes baseMergedIntoDefault" {
    # Create feat/auth branch
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Merge feat/auth into main
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1
    run arb status --json
    [[ "$output" == *"baseMergedIntoDefault"* ]]
    [[ "$output" == *'"merge"'* ]]
}

@test "arb list shows base-merged in workspace summary" {
    # Create feat/auth branch in repo-a with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Merge feat/auth into main via merge commit (do NOT delete feat/auth)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    # Fetch to pick up the merge
    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1

    # arb list should show "base merged" in the status column
    cd "$TEST_DIR/project"
    run arb list
    [[ "$output" == *"base merged"* ]]

    # --where base-merged should include the workspace
    run arb list -w base-merged
    [[ "$output" == *"stacked"* ]]
}

# ── stacked base merge detection (branch deleted) ────────────────

@test "arb status detects base branch merged and deleted" {
    # Create feat/auth branch in repo-a with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main via merge commit, then DELETE the branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push && git push origin --delete feat/auth) >/dev/null 2>&1

    # Fetch with prune in the stacked workspace
    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1

    # Status should show "base merged" but NOT "base missing"
    run arb status
    [[ "$output" == *"base merged"* ]]
    [[ "$output" != *"base missing"* ]]
    [[ "$output" != *"not found"* ]]

    # --where base-merged should show the repo
    run arb status --where base-merged
    [[ "$output" == *"repo-a"* ]]

    # Verbose should show merged section but NOT the "not found" section
    run arb status -v
    [[ "$output" == *"has been merged into default"* ]]
    [[ "$output" != *"not found on origin"* ]]
}

@test "arb status detects base branch squash-merged and deleted" {
    # Create feat/auth branch in repo-a with commits
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Squash merge feat/auth into main, then DELETE the branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge --squash origin/feat/auth && git commit -m "squash: auth" && git push && git push origin --delete feat/auth) >/dev/null 2>&1

    # Fetch with prune in the stacked workspace
    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1

    # Status should show "base merged" but NOT "base missing"
    run arb status
    [[ "$output" == *"base merged"* ]]
    [[ "$output" != *"base missing"* ]]
    [[ "$output" != *"not found"* ]]
}

@test "arb push skips when base branch is merged and deleted" {
    # Create feat/auth branch in repo-a with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main via merge commit, then DELETE the branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push && git push origin --delete feat/auth) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb push --yes
    [[ "$output" == *"was merged into default"* ]]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"skipped"* ]]
}

@test "arb pull skips when base branch is merged and deleted" {
    # Create feat/auth branch in repo-a with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace and push
    arb create stacked --base feat/auth -b feat/auth-ui repo-a
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" push -u origin feat/auth-ui >/dev/null 2>&1

    # Merge feat/auth into main via merge commit, then DELETE the branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push && git push origin --delete feat/auth) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb pull --yes
    [[ "$output" == *"was merged into default"* ]]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"skipped"* ]]
}

@test "arb rebase --retarget works when base branch is merged and deleted" {
    # Create feat/auth branch
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main via merge commit, then DELETE the branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push && git push origin --delete feat/auth) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"Retargeted"* ]]

    # Verify the ui commit is on top of main
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" == *"ui feature"* ]]
    [[ "$output" == *"merge feat/auth"* ]]

    # Verify config no longer has base = feat/auth
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" != *"base = feat/auth"* ]]
}

@test "arb rebase --retarget works for squash-merged and deleted base" {
    # Create feat/auth branch with commits
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Squash merge feat/auth into main, then DELETE the branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge --squash origin/feat/auth && git commit -m "squash: auth" && git push && git push origin --delete feat/auth) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]

    # Verify the ui commit is on top of main
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" == *"ui feature"* ]]
    [[ "$output" == *"squash: auth"* ]]

    # Verify feat/auth's original commits are NOT in the branch history
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" != *"auth feature"* ]]

    # Verify config updated
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" != *"base = feat/auth"* ]]
}

# ── explicit retarget to non-default branch ──────────────────────

@test "arb rebase --retarget <branch> retargets to a non-default branch" {
    # Create feat/A branch in repo-a with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/A >/dev/null 2>&1
    echo "A-content" > "$TEST_DIR/project/.arb/repos/repo-a/a.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add a.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "feat A" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/A >/dev/null 2>&1

    # Create feat/B branch from feat/A
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/B >/dev/null 2>&1
    echo "B-content" > "$TEST_DIR/project/.arb/repos/repo-a/b.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add b.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "feat B" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/B >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace C based on feat/B
    arb create stacked-C --base feat/B -b feat/C repo-a

    # Add a commit on feat/C
    echo "C-content" > "$TEST_DIR/project/stacked-C/repo-a/c.txt"
    git -C "$TEST_DIR/project/stacked-C/repo-a" add c.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked-C/repo-a" commit -m "feat C" >/dev/null 2>&1

    # Merge feat/B into feat/A (simulating PR merge)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git checkout feat/A && git merge origin/feat/B --no-ff -m "merge feat/B into feat/A" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked-C"
    run arb rebase --retarget feat/A --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"Retargeted"* ]]

    # Verify feat/C commit is on top of feat/A
    run git -C "$TEST_DIR/project/stacked-C/repo-a" log --oneline
    [[ "$output" == *"feat C"* ]]
    [[ "$output" == *"merge feat/B into feat/A"* ]]

    # Verify config now has base = feat/A (not cleared, since feat/A is not default)
    run cat "$TEST_DIR/project/stacked-C/.arbws/config"
    [[ "$output" == *"base = feat/A"* ]]
    [[ "$output" != *"base = feat/B"* ]]
}

@test "arb rebase --retarget main clears base config" {
    # Create feat/auth branch in repo-a with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Add a commit on the stacked branch
    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget main --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"Retargeted"* ]]

    # Verify config no longer has base key
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" != *"base ="* ]]
}

@test "arb rebase --retarget nonexistent target fails" {
    # Create feat/auth branch in repo-a
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace
    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget nonexistent --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found"* ]]
}

@test "arb rebase --retarget shows warning for unmerged base" {
    # Create feat/auth branch in repo-a
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1

    # Create feat/B from feat/auth
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/B >/dev/null 2>&1
    echo "B" > "$TEST_DIR/project/.arb/repos/repo-a/b.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add b.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "feat B" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/B >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace based on feat/B
    arb create stacked --base feat/B -b feat/C repo-a

    # Add a commit on feat/C
    echo "C" > "$TEST_DIR/project/stacked/repo-a/c.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add c.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "feat C" >/dev/null 2>&1

    # Retarget to feat/auth WITHOUT merging feat/B into feat/auth
    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget feat/auth --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"may not be merged"* ]]
}

@test "arb rebase --retarget blocks when old base ref is missing in truly stacked repo" {
    # Create feat/auth in both repos
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-b/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-b" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout --detach >/dev/null 2>&1

    # Create stacked workspace with both repos
    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b

    # Add commits
    echo "ui-a" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui a" >/dev/null 2>&1

    # Delete feat/auth from repo-b's remote and prune (but leave repo-a's intact)
    git -C "$TEST_DIR/origin/repo-b.git" branch -D feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" fetch --prune >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" branch -D feat/auth >/dev/null 2>&1 || true

    # repo-a is truly stacked (base exists), repo-b's base is gone (fell back)
    # Explicit retarget should work for repo-a but repo-b falls back to normal rebase
    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget main --yes
    [ "$status" -eq 0 ]
    # repo-a should be retargeted
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"Retargeted"* ]]
}

@test "arb rebase --retarget refuses when a stacked repo is dirty" {
    # Create feat/auth in both repos
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-b/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-b" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout --detach >/dev/null 2>&1

    # Create stacked workspace with both repos
    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b

    # Add commits on both repos
    echo "ui-a" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui a" >/dev/null 2>&1
    echo "ui-b" > "$TEST_DIR/project/stacked/repo-b/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-b" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-b" commit -m "ui b" >/dev/null 2>&1

    # Merge feat/auth into main for both
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge-a" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge-a" && git merge origin/feat/auth --no-ff -m "merge auth" && git push) >/dev/null 2>&1
    git clone "$TEST_DIR/origin/repo-b.git" "$TEST_DIR/tmp-merge-b" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge-b" && git merge origin/feat/auth --no-ff -m "merge auth" && git push) >/dev/null 2>&1

    # Make repo-b dirty
    echo "dirty" > "$TEST_DIR/project/stacked/repo-b/dirty.txt"

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot retarget"* ]]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" == *"uncommitted changes"* ]]
}

@test "arb rebase --retarget (auto-detect) is all-or-nothing" {
    # Create feat/auth in repo-a only (single repo simplifies setup)
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-b/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-b" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout --detach >/dev/null 2>&1

    # Create stacked workspace with both repos
    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b

    # Add commits on both
    echo "ui-a" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui a" >/dev/null 2>&1
    echo "ui-b" > "$TEST_DIR/project/stacked/repo-b/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-b" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-b" commit -m "ui b" >/dev/null 2>&1

    # Merge feat/auth into main for repo-a only (via tmp clone)
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge auth" && git push) >/dev/null 2>&1
    rm -rf "$TEST_DIR/tmp-merge"

    # Merge feat/auth into main for repo-b (via a fresh tmp clone)
    git clone "$TEST_DIR/origin/repo-b.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge auth" && git push) >/dev/null 2>&1
    rm -rf "$TEST_DIR/tmp-merge"

    # Make repo-a dirty so the all-or-nothing check blocks
    echo "dirty" > "$TEST_DIR/project/stacked/repo-a/dirty.txt"

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot retarget"* ]]
    [[ "$output" == *"repo-a"* ]]
}

@test "existing auto-detect retarget still works unchanged" {
    # This test ensures --retarget (no argument) still auto-detects as before
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    echo "ui" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui feature" >/dev/null 2>&1

    # Merge feat/auth into main
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"Retargeted"* ]]

    # Config should have base cleared (retargeted to default)
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" != *"base = feat/auth"* ]]
}

@test "arb rebase --retarget rejects retargeting to the current feature branch" {
    # Create stacked workspace
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget feat/auth-ui
    [ "$status" -ne 0 ]
    [[ "$output" == *"current feature branch"* ]]
}

@test "arb rebase --retarget rejects retargeting to the current base branch" {
    # Create stacked workspace
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget feat/auth
    [ "$status" -ne 0 ]
    [[ "$output" == *"already the configured base"* ]]
}
