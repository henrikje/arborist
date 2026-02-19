#!/usr/bin/env bats

load test_helper/common-setup

# ── fork workflow (multiple remotes) ─────────────────────────────

@test "arb clone --upstream sets up fork layout" {
    git init --bare "$TEST_DIR/upstream/clone-fork.git" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-clone-fork"
    git clone "$TEST_DIR/upstream/clone-fork.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"
    git clone --bare "$TEST_DIR/upstream/clone-fork.git" "$TEST_DIR/fork/clone-fork.git" >/dev/null 2>&1

    run arb clone "$TEST_DIR/fork/clone-fork.git" clone-fork --upstream "$TEST_DIR/upstream/clone-fork.git"
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/clone-fork/.git" ]

    # Verify remotes are set up
    local remotes
    remotes="$(git -C "$TEST_DIR/project/.arb/repos/clone-fork" remote)"
    [[ "$remotes" == *"origin"* ]]
    [[ "$remotes" == *"upstream"* ]]

    # Verify remote.pushDefault
    local push_default
    push_default="$(git -C "$TEST_DIR/project/.arb/repos/clone-fork" config remote.pushDefault)"
    [ "$push_default" = "origin" ]
}

@test "fork: create workspace branches from upstream" {
    setup_fork_repo repo-a

    # Add a commit to upstream that fork doesn't have
    local tmp_clone="$TEST_DIR/tmp-upstream-commit"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream-content" > upstream.txt && git add upstream.txt && git commit -m "upstream commit" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    # Fetch upstream in canonical repo
    git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch upstream >/dev/null 2>&1

    arb create fork-ws repo-a

    # Worktree should have the upstream commit (branched from upstream/main)
    [ -f "$TEST_DIR/project/fork-ws/repo-a/upstream.txt" ]
}

@test "fork: push targets the share remote (origin/fork)" {
    setup_fork_repo repo-a
    arb create fork-push repo-a
    cd "$TEST_DIR/project/fork-push"

    # Make a commit
    (cd repo-a && echo "feature" > feature.txt && git add feature.txt && git commit -m "feature commit") >/dev/null 2>&1

    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]

    # Branch should exist on fork (origin), not on upstream
    local fork_branch
    fork_branch="$(git -C "$TEST_DIR/fork/repo-a.git" branch)"
    [[ "$fork_branch" == *"fork-push"* ]]
}

@test "fork: rebase targets the upstream remote" {
    setup_fork_repo repo-a
    arb create fork-rebase repo-a

    # Add commits to upstream after workspace creation
    local tmp_clone="$TEST_DIR/tmp-upstream-rebase"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream-update" > update.txt && git add update.txt && git commit -m "upstream update" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-rebase"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"rebased fork-rebase onto upstream/main"* ]] || [[ "$output" == *"Rebased"* ]]

    # Workspace should now have the upstream commit
    [ -f "$TEST_DIR/project/fork-rebase/repo-a/update.txt" ]
}

@test "fork: fetch fetches both remotes" {
    setup_fork_repo repo-a
    arb create fork-fetch repo-a

    # Add a commit to upstream
    local tmp_clone="$TEST_DIR/tmp-upstream-fetch"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "new" > new.txt && git add new.txt && git commit -m "new on upstream" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-fetch"
    run arb fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]

    # upstream/main should have the new commit
    local upstream_log
    upstream_log="$(git -C "$TEST_DIR/project/.arb/repos/repo-a" log --oneline upstream/main)"
    [[ "$upstream_log" == *"new on upstream"* ]]
}

@test "fork: status shows upstream remote in BASE column" {
    setup_fork_repo repo-a
    arb create fork-status repo-a
    cd "$TEST_DIR/project/fork-status"

    run arb status
    # BASE column should show upstream/main since upstream ≠ share
    [[ "$output" == *"upstream/main"* ]]
    # SHARE column should show origin/<branch>
    [[ "$output" == *"origin/fork-status"* ]]
}

@test "fork: remove --delete-remote deletes from share remote" {
    setup_fork_repo repo-a
    arb create fork-remove repo-a

    # Push the branch first
    (cd "$TEST_DIR/project/fork-remove/repo-a" && echo "x" > x.txt && git add x.txt && git commit -m "x" && git push -u origin fork-remove) >/dev/null 2>&1

    # Verify branch exists on fork
    run git -C "$TEST_DIR/fork/repo-a.git" branch
    [[ "$output" == *"fork-remove"* ]]

    run arb remove fork-remove --force --delete-remote
    [ "$status" -eq 0 ]

    # Branch should be deleted from fork
    run git -C "$TEST_DIR/fork/repo-a.git" branch
    [[ "$output" != *"fork-remove"* ]]

    # Branch should NOT have been deleted from upstream
    run git -C "$TEST_DIR/upstream/repo-a.git" branch
    [[ "$output" != *"fork-remove"* ]]
}

@test "fork: mixed workspace — some repos forked, some single-origin" {
    setup_fork_repo repo-a
    # repo-b keeps its single-origin setup from the main setup()

    arb create mixed-ws repo-a repo-b
    cd "$TEST_DIR/project/mixed-ws"

    run arb status
    # repo-a should show upstream/main, repo-b should show just main
    [[ "$output" == *"upstream/main"* ]]
}

@test "fork: convention detection — upstream remote without pushDefault" {
    # Set up a repo with upstream remote but without pushDefault
    local upstream_dir="$TEST_DIR/upstream/conv-test.git"
    local fork_dir="$TEST_DIR/fork/conv-test.git"

    git init --bare "$upstream_dir" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-conv"
    git clone "$upstream_dir" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    git clone --bare "$upstream_dir" "$fork_dir" >/dev/null 2>&1
    git clone "$fork_dir" "$TEST_DIR/project/.arb/repos/conv-test" >/dev/null 2>&1

    # Add upstream remote but do NOT set pushDefault — relies on convention
    git -C "$TEST_DIR/project/.arb/repos/conv-test" remote add upstream "$upstream_dir"
    git -C "$TEST_DIR/project/.arb/repos/conv-test" fetch upstream >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/conv-test" remote set-head upstream --auto >/dev/null 2>&1

    arb create conv-ws conv-test
    cd "$TEST_DIR/project/conv-ws"

    run arb status
    [[ "$output" == *"upstream/main"* ]]
}

@test "fork: non-standard remote names with pushDefault" {
    local canonical_dir="$TEST_DIR/upstream/custom-names.git"
    local fork_dir="$TEST_DIR/fork/custom-names.git"

    git init --bare "$canonical_dir" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-custom"
    git clone "$canonical_dir" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    git clone --bare "$canonical_dir" "$fork_dir" >/dev/null 2>&1
    git clone "$fork_dir" "$TEST_DIR/project/.arb/repos/custom-names" >/dev/null 2>&1

    # Add canonical remote (not named "upstream") and set pushDefault
    git -C "$TEST_DIR/project/.arb/repos/custom-names" remote add canonical "$canonical_dir"
    git -C "$TEST_DIR/project/.arb/repos/custom-names" config remote.pushDefault origin
    git -C "$TEST_DIR/project/.arb/repos/custom-names" fetch canonical >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/custom-names" remote set-head canonical --auto >/dev/null 2>&1

    arb create custom-ws custom-names
    cd "$TEST_DIR/project/custom-ws"

    run arb status
    # Should show canonical/main since canonical is the upstream remote
    [[ "$output" == *"canonical/main"* ]]
}

@test "fork: single-origin repos show origin/ prefix in BASE column" {
    # Create a workspace with standard single-origin repo
    arb create single-origin-ws repo-a repo-b
    cd "$TEST_DIR/project/single-origin-ws"

    run arb status
    # BASE column should show origin/main (always includes remote prefix)
    [[ "$output" == *"origin/main"* ]]
}

@test "fork: merge targets the upstream remote" {
    setup_fork_repo repo-a
    arb create fork-merge repo-a

    # Add commits to upstream after workspace creation
    local tmp_clone="$TEST_DIR/tmp-upstream-merge"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream-merge-update" > merge-update.txt && git add merge-update.txt && git commit -m "upstream merge update" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-merge"
    run arb merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"merged upstream/main into fork-merge"* ]] || [[ "$output" == *"Merged"* ]]

    # Workspace should now have the upstream commit
    [ -f "$TEST_DIR/project/fork-merge/repo-a/merge-update.txt" ]
}

@test "fork: ambiguous remotes error with 3 remotes and no pushDefault" {
    # Set up a repo with 3 remotes and no pushDefault or "upstream" name
    local bare_a="$TEST_DIR/upstream/ambig.git"
    local bare_b="$TEST_DIR/fork/ambig.git"
    local bare_c="$TEST_DIR/staging/ambig.git"

    git init --bare "$bare_a" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-ambig"
    git clone "$bare_a" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    git clone --bare "$bare_a" "$bare_b" >/dev/null 2>&1
    mkdir -p "$TEST_DIR/staging"
    git clone --bare "$bare_a" "$bare_c" >/dev/null 2>&1

    git clone "$bare_b" "$TEST_DIR/project/.arb/repos/ambig" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/ambig" remote add canonical "$bare_a"
    git -C "$TEST_DIR/project/.arb/repos/ambig" remote add staging "$bare_c"

    # No pushDefault set, no "upstream" name — should be ambiguous
    # Create still works (falls back to origin for remote operations)
    run arb create ambig-ws ambig
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/ambig-ws/ambig" ]

    # Status runs without crashing (exit 0 — fresh branch with no commits is not unpushed)
    cd "$TEST_DIR/project/ambig-ws"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"ambig"* ]]
}

@test "fork: pull syncs from share remote" {
    setup_fork_repo repo-a
    arb create fork-pull repo-a

    # Push the branch to the fork (origin)
    (cd "$TEST_DIR/project/fork-pull/repo-a" && echo "initial" > init.txt && git add init.txt && git commit -m "initial" && git push -u origin fork-pull) >/dev/null 2>&1

    # Simulate someone else pushing to the fork
    local tmp_clone="$TEST_DIR/tmp-fork-pull"
    git clone "$TEST_DIR/fork/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git checkout fork-pull && echo "from-fork" > fork-change.txt && git add fork-change.txt && git commit -m "fork commit" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-pull"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pulled"* ]]

    # Should have the fork commit
    [ -f "$TEST_DIR/project/fork-pull/repo-a/fork-change.txt" ]
}

@test "fork: arb add in fork workspace sets up remotes correctly" {
    setup_fork_repo repo-a

    # Set up a second fork repo
    local upstream_b="$TEST_DIR/upstream/repo-b-fork.git"
    local fork_b="$TEST_DIR/fork/repo-b-fork.git"

    git init --bare "$upstream_b" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-repo-b-fork"
    git clone "$upstream_b" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream content" > file.txt && git add file.txt && git commit -m "upstream init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"
    git clone --bare "$upstream_b" "$fork_b" >/dev/null 2>&1

    # Clone fork as the canonical repo
    rm -rf "$TEST_DIR/project/.arb/repos/repo-b-fork"
    git clone "$fork_b" "$TEST_DIR/project/.arb/repos/repo-b-fork" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" remote add upstream "$upstream_b"
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" config remote.pushDefault origin
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" fetch upstream >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" remote set-head upstream --auto >/dev/null 2>&1

    # Create workspace with repo-a only
    arb create fork-add repo-a

    # Add the second fork repo
    cd "$TEST_DIR/project/fork-add"
    run arb add repo-b-fork
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/fork-add/repo-b-fork" ]

    # Verify the branch was created from upstream (has upstream content)
    [ -f "$TEST_DIR/project/fork-add/repo-b-fork/file.txt" ]
}

@test "fork: clone --upstream fails gracefully with bad upstream URL" {
    git init --bare "$TEST_DIR/fork/bad-upstream.git" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-bad-upstream"
    git clone "$TEST_DIR/fork/bad-upstream.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    run arb clone "$TEST_DIR/fork/bad-upstream.git" bad-upstream --upstream "/nonexistent/path/repo.git"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Failed to fetch upstream"* ]]
}

