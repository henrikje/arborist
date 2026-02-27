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

@test "arb attach respects stored base branch" {
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
    arb attach repo-b
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

@test "arb attach falls back to default branch when workspace base missing in repo" {
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
    run arb attach repo-b
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
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb rebase --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
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

@test "arb rebase repo-a only fetches named repo" {
    arb create my-feature repo-a repo-b

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase repo-a --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched 1 repo"* ]]
    [[ "$output" == *"Rebased 1 repo"* ]]
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
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb merge --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
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
    fetch_all_repos

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
    fetch_all_repos

    # Status should show "base merged"
    run arb status
    [[ "$output" == *"base merged"* ]]
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
    fetch_all_repos
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
    fetch_all_repos

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
    fetch_all_repos

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
    fetch_all_repos

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
    [[ "$output" == *"uncommitted changes (use --autostash)"* ]]
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


# ── autostash ─────────────────────────────────────────────────────

@test "arb rebase --autostash stashes and rebases dirty repo" {
    arb create my-feature repo-a

    # Push upstream change
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Make worktree dirty (modified file)
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --autostash --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased"* ]]

    # Upstream commit should be reachable
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream"* ]]

    # Dirty file should still be present (re-applied)
    [ -f "$TEST_DIR/project/my-feature/repo-a/dirty.txt" ]
}

@test "arb merge --autostash stashes and merges dirty repo" {
    arb create my-feature repo-a

    # Push upstream change
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    # Make worktree dirty (modified file)
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb merge --autostash --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Merged"* ]]

    # Upstream commit should be reachable
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream change"* ]]

    # Dirty file should still be present (re-applied)
    [ -f "$TEST_DIR/project/my-feature/repo-a/dirty.txt" ]
}

@test "arb pull --autostash stashes and pulls dirty repo (rebase)" {
    arb create my-feature repo-a

    # Push the feature branch first
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "local" > local.txt && git add local.txt && git commit -m "local" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a remote commit to the feature branch via a tmp clone
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > remote.txt && git add remote.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    # Make worktree dirty
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --autostash --rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pulled"* ]]

    # Remote commit should be reachable
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"remote"* ]]

    # Dirty file should still be present
    [ -f "$TEST_DIR/project/my-feature/repo-a/dirty.txt" ]
}

@test "arb pull --autostash stashes and pulls dirty repo (merge)" {
    arb create my-feature repo-a

    # Push the feature branch first
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "local" > local.txt && git add local.txt && git commit -m "local" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a remote commit to the feature branch via a tmp clone
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > remote.txt && git add remote.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    # Make worktree dirty
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --autostash --merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pulled"* ]]

    # Remote commit should be reachable
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"remote"* ]]

    # Dirty file should still be present
    [ -f "$TEST_DIR/project/my-feature/repo-a/dirty.txt" ]
}

@test "arb rebase --retarget --autostash stashes dirty repo during retarget" {
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

    # Merge feat/auth into main
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-merge" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-merge" && git merge origin/feat/auth --no-ff -m "merge feat/auth" && git push) >/dev/null 2>&1

    # Make worktree dirty (staged file)
    echo "dirty" > "$TEST_DIR/project/stacked/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --autostash --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"retarget"* ]]
    [[ "$output" == *"Retargeted"* ]]

    # Dirty file should still be present (re-applied)
    [ -f "$TEST_DIR/project/stacked/repo-a/dirty.txt" ]

    # The ui commit should be on top of main
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" == *"ui feature"* ]]
}

@test "arb rebase --retarget refuses dirty repo without --autostash but succeeds with it" {
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
    git -C "$TEST_DIR/project/stacked/repo-b" add dirty.txt >/dev/null 2>&1

    # Without --autostash should fail (all-or-nothing)
    cd "$TEST_DIR/project/stacked"
    run arb rebase --retarget --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot retarget"* ]]

    # With --autostash should succeed
    run arb rebase --retarget --autostash --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Retargeted"* ]]

    # Dirty file should still be present
    [ -f "$TEST_DIR/project/stacked/repo-b/dirty.txt" ]
}

@test "arb rebase --autostash with multiple repos (mixed dirty/clean)" {
    arb create my-feature repo-a repo-b

    # Push upstream changes to both repos
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-a" > upstream.txt && git add upstream.txt && git commit -m "upstream a" && git push) >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-b" && echo "upstream-b" > upstream.txt && git add upstream.txt && git commit -m "upstream b" && git push) >/dev/null 2>&1

    # Make only repo-a dirty
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --autostash --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased 2 repos"* ]]
    [[ "$output" == *"autostash"* ]]

    # Both upstream commits reachable
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream a"* ]]
    run git -C "$TEST_DIR/project/my-feature/repo-b" log --oneline
    [[ "$output" == *"upstream b"* ]]

    # Dirty file should still be present in repo-a
    [ -f "$TEST_DIR/project/my-feature/repo-a/dirty.txt" ]
}

@test "arb rebase --autostash with repo filter only processes named repos" {
    arb create my-feature repo-a repo-b

    # Push upstream changes to both repos
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-a" > upstream.txt && git add upstream.txt && git commit -m "upstream a" && git push) >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-b" && echo "upstream-b" > upstream.txt && git add upstream.txt && git commit -m "upstream b" && git push) >/dev/null 2>&1

    # Make both repos dirty
    echo "dirty-a" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1
    echo "dirty-b" > "$TEST_DIR/project/my-feature/repo-b/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --autostash --yes repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased 1 repo"* ]]

    # repo-a should have upstream commit
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream a"* ]]
}

@test "arb pull --autostash reports stash pop failure (merge)" {
    arb create my-feature repo-a

    # Push the feature branch first with a shared file
    echo "original" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    (cd "$TEST_DIR/project/my-feature/repo-a" && git add shared.txt && git commit -m "add shared" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a remote commit that changes the shared file
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote version" > shared.txt && git add shared.txt && git commit -m "remote change" && git push) >/dev/null 2>&1

    # Make a local dirty change to the same shared file
    echo "dirty version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"

    cd "$TEST_DIR/project/my-feature"
    run arb pull --autostash --merge --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"stash pop failed"* ]]
    [[ "$output" == *"manual stash application"* ]]
}

@test "arb merge --autostash reports stash pop failure" {
    arb create my-feature repo-a

    # Create a shared file on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull the shared file into the feature branch
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    # Create upstream change to the shared file
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    # Make a dirty change to the same shared file (will conflict on stash pop)
    echo "dirty version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"

    cd "$TEST_DIR/project/my-feature"
    run arb merge --autostash --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"stash pop failed"* ]]
    [[ "$output" == *"manual stash application"* ]]
    [[ "$output" == *"git stash pop"* ]]
}

# ── --verbose ────────────────────────────────────────────────────

@test "arb rebase --verbose --dry-run shows incoming commit subjects" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"

    # Push upstream commits
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "change1" > v1.txt && git add v1.txt && git commit -m "feat: first upstream change" && git push) >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "change2" > v2.txt && git add v2.txt && git commit -m "fix: second upstream change" && git push) >/dev/null 2>&1

    run arb rebase --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Incoming from origin/main"* ]]
    [[ "$output" == *"feat: first upstream change"* ]]
    [[ "$output" == *"fix: second upstream change"* ]]
}

@test "arb merge --verbose --dry-run shows incoming commit subjects" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"

    # Push upstream commits
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "change1" > v1.txt && git add v1.txt && git commit -m "feat: merge verbose test" && git push) >/dev/null 2>&1

    run arb merge --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Incoming from origin/main"* ]]
    [[ "$output" == *"feat: merge verbose test"* ]]
}

@test "arb rebase --dry-run without --verbose does not show commits" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "change1" > v1.txt && git add v1.txt && git commit -m "feat: should not appear" && git push) >/dev/null 2>&1

    run arb rebase --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" != *"Incoming from"* ]]
    [[ "$output" != *"feat: should not appear"* ]]
}

# ── diverged commit matching in plan ─────────────────────────────

@test "arb rebase --verbose --dry-run shows same/new breakdown when cherry-picked" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/feature.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add feature.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature work" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Cherry-pick the feature commit onto main (with a diverging commit first)
    local feature_sha
    feature_sha="$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse HEAD)"
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream work" && git cherry-pick "$feature_sha" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb rebase --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"same"* ]]
    [[ "$output" == *"(same as"* ]]
}

@test "arb rebase --verbose --dry-run shows squash annotation when branch is squash-merged onto base" {
    arb create my-feature repo-a
    echo "first" > "$TEST_DIR/project/my-feature/repo-a/first.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add first.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first feature" >/dev/null 2>&1
    echo "second" > "$TEST_DIR/project/my-feature/repo-a/second.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add second.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "second feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Squash merge the feature commits onto main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && git merge --squash origin/my-feature && git commit -m "squash: first and second" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb rebase --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"(squash of"* ]]
}

@test "arb rebase --verbose --dry-run shows no match annotations for genuinely different commits" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/feature.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add feature.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature work" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Different commit on main (not a cherry-pick)
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream work" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb rebase --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" != *"(same as"* ]]
    [[ "$output" != *"(squash of"* ]]
}

# ── --graph flag ────────────────────────────────────────────────

@test "arb rebase --graph --dry-run shows merge-base line" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"

    # Push upstream commits to make repo behind
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "change1" > v1.txt && git add v1.txt && git commit -m "feat: graph test upstream" && git push) >/dev/null 2>&1

    run arb rebase --graph --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"merge-base"* ]]
    [[ "$output" == *"origin/main"* ]]
}

@test "arb rebase --graph --verbose --dry-run shows commits in graph" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"

    # Push upstream commits and make a local commit
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "change1" > v1.txt && git add v1.txt && git commit -m "feat: graph verbose incoming" && git push) >/dev/null 2>&1
    (cd repo-a && echo "local" > local.txt && git add local.txt && git commit -m "feat: graph verbose outgoing") >/dev/null 2>&1

    run arb rebase --graph --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"merge-base"* ]]
    [[ "$output" == *"feat: graph verbose incoming"* ]]
    [[ "$output" == *"feat: graph verbose outgoing"* ]]
    # Separate "Incoming from..." section should NOT appear when graph is active
    [[ "$output" != *"Incoming from"* ]]
}

@test "arb merge --graph --dry-run shows graph" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "change1" > v1.txt && git add v1.txt && git commit -m "feat: merge graph test" && git push) >/dev/null 2>&1

    run arb merge --graph --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"merge-base"* ]]
    [[ "$output" == *"origin/main"* ]]
}
