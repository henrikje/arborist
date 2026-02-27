#!/usr/bin/env bats

load test_helper/common-setup

# ── status ───────────────────────────────────────────────────────

@test "arb status shows ahead count after local commit" {
    arb create my-feature repo-a
    echo "new" > "$TEST_DIR/project/my-feature/repo-a/new.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add new.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "ahead" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"1 ahead"* ]]
}

@test "arb status shows behind count when default branch is ahead" {
    arb create my-feature repo-a

    # Add a commit to origin's default branch
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status shows not pushed when branch not on remote" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"not pushed"* ]]
}

@test "arb status shows up to date after push with no new commits" {
    arb create my-feature repo-a

    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [[ "$output" == *"up to date"* ]]
}

@test "arb status without workspace context fails" {
    run arb status
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

@test "arb status shows drifted branch in branch column" {
    arb create my-feature repo-a repo-b
    # Manually switch repo-a to a different branch
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    # repo-a should show experiment in branch column and origin/experiment in remote column
    [[ "$output" == *"repo-a"*"experiment"* ]]
    [[ "$output" == *"origin/experiment"* ]]
    # repo-b should show expected branch
    [[ "$output" == *"repo-b"*"my-feature"* ]]
}

@test "arb status uses configured base branch for stacked workspaces" {
    # Create a base branch with 2 unique commits in repo-a
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    echo "auth2" > "$TEST_DIR/project/.arb/repos/repo-a/auth2.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth2.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth2" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # repo-b does NOT have feat/auth — only main

    # Create stacked workspace with both repos
    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b

    # Add a commit to the feature branch in repo-a (on top of feat/auth)
    echo "ui-change" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui change" >/dev/null 2>&1

    # Add a commit to the feature branch in repo-b (on top of main)
    echo "ui-change-b" > "$TEST_DIR/project/stacked/repo-b/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-b" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-b" commit -m "ui change b" >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    fetch_all_repos
    run arb status

    # repo-a: should compare against feat/auth (1 ahead, not 3 ahead which it would be vs main)
    [[ "$output" == *"repo-a"*"feat/auth"*"1 ahead"* ]]

    # repo-b: base branch feat/auth doesn't exist — should show configured base with "not found"
    [[ "$output" == *"repo-b"*"feat/auth"*"not found"* ]]
}

@test "default branch detection with master" {
    git init --bare "$TEST_DIR/origin/repo-master.git" -b master >/dev/null 2>&1
    git clone "$TEST_DIR/origin/repo-master.git" "$TEST_DIR/project/.arb/repos/repo-master" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-master" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1

    arb create test-master repo-master
    cd "$TEST_DIR/project/test-master"
    run arb status
    [[ "$output" == *"master"* ]]
}

@test "arb status --fetch fetches before showing status" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --fetch
    [[ "$output" == *"repo-a"* ]]
}

@test "arb status -F fetches before showing status" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status -F
    [[ "$output" == *"repo-a"* ]]
}

@test "arb status shows origin to push count" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Now make another commit without pushing
    echo "more" > "$TEST_DIR/project/my-feature/repo-a/g.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add g.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "second" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [[ "$output" == *"1 to push"* ]]
}

@test "arb status shows origin to pull count" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Clone a fresh copy, push a commit to origin on my-feature
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [[ "$output" == *"1 to pull"* ]]
}

@test "arb status on default branch behind origin shows to pull not merged" {
    # Detach HEAD in canonical repo so a main worktree can be created
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1
    arb create main-ws --branch main repo-a
    # Push a commit directly to origin's main
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-main" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-main" && echo "new" > new.txt && git add new.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/main-ws"
    fetch_all_repos
    run arb status
    [[ "$output" == *"1 to pull"* ]]
    [[ "$output" != *"merged"* ]]
}

@test "arb status never-pushed branch behind base does not show merged" {
    arb create never-pushed repo-a
    # Advance origin's main so the branch is behind base
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-advance" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-advance" && echo "new" > new.txt && git add new.txt && git commit -m "advance main" && git push) >/dev/null 2>&1
    rm -rf "$TEST_DIR/tmp-advance"
    cd "$TEST_DIR/project/never-pushed"
    fetch_all_repos
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"not pushed"* ]]
    [[ "$output" != *"merged"* ]]
}

@test "arb status shows pushed and synced repo as up to date" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
    [[ "$output" == *"clean"* ]]
}

@test "arb status shows ahead of base and pushed as up to date remote" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    echo "change2" > "$TEST_DIR/project/my-feature/repo-a/g.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add g.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "second" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [[ "$output" == *"2 ahead"* ]]
    [[ "$output" == *"origin/my-feature"*"up to date"* ]]
}

@test "arb status shows diverged base counts" {
    arb create my-feature repo-a
    # Make a local commit
    echo "local" > "$TEST_DIR/project/my-feature/repo-a/local.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add local.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Advance main on origin
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [[ "$output" == *"1 ahead"* ]]
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status shows detached HEAD" {
    arb create my-feature repo-a
    # Detach HEAD in the worktree
    local head_sha
    head_sha="$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse HEAD)"
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout "$head_sha" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"(detached)"* ]]
    [[ "$output" == *"detached"* ]]
}

@test "arb status detects upstream mismatch" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Create another remote branch and set upstream to it
    git -C "$TEST_DIR/project/my-feature/repo-a" push origin my-feature:other-branch >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" branch --set-upstream-to=origin/other-branch >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    # Remote column should show origin/other-branch (mismatch)
    [[ "$output" == *"origin/other-branch"* ]]
}

@test "arb status shows multiple local change types" {
    arb create my-feature repo-a
    # Create a tracked file, commit, then modify
    echo "orig" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add tracked.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "add tracked" >/dev/null 2>&1
    # Stage a new file
    echo "staged" > "$TEST_DIR/project/my-feature/repo-a/staged.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add staged.txt >/dev/null 2>&1
    # Modify tracked file
    echo "changed" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"1 staged"* ]]
    [[ "$output" == *"1 modified"* ]]
}

@test "arb status shows fell-back base branch for stacked workspace" {
    # repo-a has feat/auth, repo-b does NOT
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b
    cd "$TEST_DIR/project/stacked"
    fetch_all_repos
    run arb status
    # repo-a should show feat/auth as base
    [[ "$output" == *"repo-a"*"feat/auth"* ]]
    # repo-b should show configured base (feat/auth) with "not found" instead of fallback
    [[ "$output" == *"repo-b"*"feat/auth"*"not found"* ]]
}

@test "arb status detects rebase in progress" {
    arb create my-feature repo-a
    # Set up conflicting changes for rebase
    echo "base" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push a conflicting commit on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Fetch and start a rebase that will conflict
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    git -C "$TEST_DIR/project/my-feature/repo-a" rebase origin/main >/dev/null 2>&1 || true

    run arb status
    [[ "$output" == *"(rebase)"* ]]
}

@test "arb status detects merge conflicts" {
    arb create my-feature repo-a
    echo "base" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push a conflicting commit on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    # Start a merge that will conflict
    git -C "$TEST_DIR/project/my-feature/repo-a" merge origin/main >/dev/null 2>&1 || true

    run arb status
    [[ "$output" == *"conflicts"* ]]
    [[ "$output" == *"(merge)"* ]]
}

# ── missing config recovery ──────────────────────────────────────

@test "arb status works with missing config (infers branch)" {
    arb create my-feature repo-a
    delete_workspace_config my-feature
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"repo-a"* ]]
    # Should warn about missing config
    [[ "$output" == *"Config missing"* ]] || [[ "$output" == *"inferred branch"* ]]
}

@test "arb attach works when worktrees exist but config is missing" {
    arb create my-feature repo-a
    delete_workspace_config my-feature
    cd "$TEST_DIR/project/my-feature"
    run arb attach repo-b
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/my-feature/repo-b" ]
    # Verify repo-b is on the inferred branch
    local branch
    branch="$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)"
    [ "$branch" = "my-feature" ]
}

@test "arb attach fails when config is missing and no worktrees exist" {
    mkdir -p "$TEST_DIR/project/empty-ws/.arbws"
    echo "branch = empty-ws" > "$TEST_DIR/project/empty-ws/.arbws/config"
    delete_workspace_config empty-ws
    cd "$TEST_DIR/project/empty-ws"
    run arb attach repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"No branch configured"* ]] || [[ "$output" == *"no worktrees to infer"* ]]
}

@test "arb delete --force works with missing config" {
    arb create my-feature repo-a repo-b
    delete_workspace_config my-feature
    arb delete my-feature --force
    [ ! -d "$TEST_DIR/project/my-feature" ]
    # Branch should still be cleaned up
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/heads/my-feature"
    [ "$status" -ne 0 ]
}

@test "arb list shows config missing indicator" {
    arb create my-feature repo-a
    delete_workspace_config my-feature
    run arb list
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-feature"* ]]
    [[ "$output" == *"config missing"* ]]
}

@test "arb pull works with missing config (infers branch)" {
    arb create my-feature repo-a
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    delete_workspace_config my-feature
    cd "$TEST_DIR/project/my-feature"
    run arb pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"inferred branch"* ]] || [[ "$output" == *"Config missing"* ]]
}


# ── status conflict prediction ───────────────────────────────────

@test "arb status shows diverged with overlapping changes (conflict path)" {
    arb create my-feature repo-a

    # Create a shared file on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull the shared file into the feature branch
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    arb rebase --yes >/dev/null 2>&1

    # Conflicting change on feature branch
    echo "feature version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add shared.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Conflicting change on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    fetch_all_repos
    run arb status
    [ "$status" -eq 0 ]  # diverged is stale, not at-risk
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"1 ahead"* ]]
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status shows diverged with non-overlapping changes (clean path)" {
    arb create my-feature repo-a

    # Local commit on feature branch (different file)
    echo "local" > "$TEST_DIR/project/my-feature/repo-a/local.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add local.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Upstream commit on main (different file)
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    run arb status
    [ "$status" -eq 0 ]  # diverged is stale, not at-risk
    [[ "$output" == *"1 ahead"* ]]
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status with mixed diverged and non-diverged repos" {
    arb create my-feature repo-a repo-b

    # Create a shared file on main for repo-a
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull into feature branch
    cd "$TEST_DIR/project/my-feature"
    fetch_all_repos
    arb rebase --yes >/dev/null 2>&1

    # Conflicting change on feature branch for repo-a
    echo "feature version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add shared.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Conflicting change on main for repo-a
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    # repo-b stays equal (no changes)

    fetch_all_repos
    run arb status
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" == *"equal"* ]]
}

# ── status rebased detection ──────────────────────────────────────

@test "arb status shows rebased instead of push/pull after rebase" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Advance main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Rebase feature onto advanced main
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    fetch_all_repos
    run arb status
    # Should show "rebased" instead of misleading "to push, to pull"
    [[ "$output" == *"rebased"* ]]
    [[ "$output" != *"to pull"* ]]
}

@test "arb status -v shows (rebased) annotations on commits" {
    arb create my-feature repo-a
    echo "first" > "$TEST_DIR/project/my-feature/repo-a/first.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add first.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first feature" >/dev/null 2>&1
    echo "second" > "$TEST_DIR/project/my-feature/repo-a/second.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add second.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "second feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Advance main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Rebase
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    fetch_all_repos
    run arb status -v
    # Verbose output should annotate rebased commits
    [[ "$output" == *"(rebased)"* ]]
    [[ "$output" == *"first feature"* ]]
    [[ "$output" == *"second feature"* ]]
}

# ── branch header line ─────────────────────────────────────────────

@test "arb status shows branch header line" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"On branch my-feature"* ]]
}

@test "arb status shows branch and base in header line" {
    # Create a stacked workspace with an explicit base
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a
    cd "$TEST_DIR/project/stacked"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"On branch feat/auth-ui"* ]]
    [[ "$output" == *"(base: feat/auth)"* ]]
}

@test "arb status --quiet does not show branch header" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --quiet
    [ "$status" -eq 0 ]
    [[ "$output" != *"On branch"* ]]
}

@test "arb status --json does not show branch header" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --json
    [ "$status" -eq 0 ]
    [[ "$output" != *"On branch"* ]]
}

# ── compact status display ────────────────────────────────────────

@test "arb status hides BRANCH column when no repos are drifted" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" != *"BRANCH"* ]]
    [[ "$output" == *"REPO"* ]]
    [[ "$output" == *"SHARE"* ]]
}

@test "arb status shows BRANCH column when a repo is drifted" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"BRANCH"* ]]
}

@test "arb status shows BRANCH column when a repo is detached" {
    arb create my-feature repo-a
    local head_sha
    head_sha="$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse HEAD)"
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout "$head_sha" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"BRANCH"* ]]
}

@test "arb status truncates SHARE column on narrow terminal" {
    arb create my-long-branch-name-that-will-be-truncated repo-a repo-b
    cd "$TEST_DIR/project/my-long-branch-name-that-will-be-truncated"

    # First, get the untruncated width
    COLUMNS=999 run arb status
    local full_width=0
    while IFS= read -r line; do
        local plain
        plain="$(printf '%s' "$line" | sed $'s/\033\\[[0-9;]*m//g')"
        local len=${#plain}
        (( len > full_width )) && full_width=$len
    done <<< "$output"

    # Now run with a terminal narrower than the full width
    local narrow=$(( full_width - 10 ))
    COLUMNS=$narrow run arb status
    [ "$status" -eq 0 ]
    # The ellipsis character indicates truncation occurred
    [[ "$output" == *"…"* ]]
    # No content line should exceed the narrow terminal width
    local max_width=0
    while IFS= read -r line; do
        local plain
        plain="$(printf '%s' "$line" | sed $'s/\033\\[[0-9;]*m//g')"
        local len=${#plain}
        (( len > max_width )) && max_width=$len
    done <<< "$output"
    (( max_width <= narrow ))
}

# ── quiet output ──────────────────────────────────────────────────

@test "arb status -q outputs repo names only" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status -q
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" != *"REPO"* ]]
    [[ "$output" != *"BRANCH"* ]]
}

@test "arb status --quiet --where dirty outputs only dirty repo names" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    echo "dirty" > repo-a/dirty.txt
    run arb status --quiet --where dirty
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --quiet --json conflicts" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --quiet --json
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --quiet with --json"* ]]
}

@test "arb status --quiet --verbose conflicts" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --quiet --verbose
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --quiet with --verbose"* ]]
}

# ── positive filter terms ─────────────────────────────────────────

@test "arb status --where clean shows only clean repos" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    echo "dirty" > repo-a/dirty.txt
    run arb status --quiet --where clean
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" != *"repo-a"* ]]
}

@test "arb status --where safe shows repos with no at-risk flags" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    echo "dirty" > repo-a/dirty.txt
    run arb status --quiet --where safe
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" != *"repo-a"* ]]
}

# ── ^ negation prefix ─────────────────────────────────────────────

@test "arb status --where ^dirty matches clean repos" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    echo "dirty" > repo-a/dirty.txt
    run arb status --quiet --where ^dirty
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" != *"repo-a"* ]]
}

@test "arb status --where with invalid ^term shows error" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --where ^invalid
    [ "$status" -ne 0 ]
    [[ "$output" == *"Unknown filter term"* ]]
}

# ── repo positional args ──────────────────────────────────────────

@test "arb status with positional args filters repos" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status with multiple positional args filters repos" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status repo-a repo-b
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb status with invalid repo name errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status nonexistent
    [ "$status" -ne 0 ]
    [[ "$output" == *"not in this workspace"* ]]
}

@test "arb status -v with positional args shows verbose for single repo" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status -v repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"Untracked files"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status -q with positional args outputs filtered repo names" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status -q repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --json with positional args filters repos" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status --json repo-a
    [ "$status" -eq 0 ]
    local repo_count
    repo_count="$(echo "$output" | jq '.repos | length')"
    [ "$repo_count" -eq 1 ]
    local repo_name
    repo_name="$(echo "$output" | jq -r '.repos[0].name')"
    [ "$repo_name" = "repo-a" ]
}

@test "arb status positional args compose with --where" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    # Filter to both repos, then --where dirty should narrow to repo-a
    run arb status -q --where dirty repo-a repo-b
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status reads repo names from stdin" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run bash -c 'echo "repo-a" | arb status --json'
    [ "$status" -eq 0 ]
    local repo_count
    repo_count="$(echo "$output" | jq '.repos | length')"
    [ "$repo_count" -eq 1 ]
    local repo_name
    repo_name="$(echo "$output" | jq -r '.repos[0].name')"
    [ "$repo_name" = "repo-a" ]
}

# ── two-phase fetch rendering ─────────────────────────────────────

@test "arb status -F reflects fresh remote data" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push a commit to origin from a separate clone
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Without -F, should NOT see the remote commit (stale refs)
    run arb status
    [[ "$output" == *"up to date"* ]]

    # With -F, should see "1 to pull" after fetching fresh data
    run arb status -F
    [ "$status" -eq 0 ]
    [[ "$output" == *"1 to pull"* ]]
}

@test "arb status -F -v shows verbose detail after fetch" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Advance main on origin
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb status -F -v
    [ "$status" -eq 0 ]
    # Should show verbose detail — the ahead-of-base commit
    [[ "$output" == *"feature commit"* ]]
    # Should show the behind-base commit from the fetch
    [[ "$output" == *"upstream change"* ]]
}

@test "arb status -F --json produces clean JSON" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    # Redirect stderr so fetch progress doesn't pollute JSON on stdout
    local json_output
    json_output="$(arb status -F --json 2>/dev/null)"
    # Output should be valid JSON
    echo "$json_output" | jq . >/dev/null 2>&1
    local repo_name
    repo_name="$(echo "$json_output" | jq -r '.repos[0].name')"
    [ "$repo_name" = "repo-a" ]
}

# ── diverged commit matching ──────────────────────────────────────

@test "arb status -v shows (same as ...) when feature commit is cherry-picked onto base" {
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
    run arb status -v
    [ "$status" -eq 0 ]
    [[ "$output" == *"(same as"* ]]
    [[ "$output" == *"feature work"* ]]
}
