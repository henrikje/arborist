#!/usr/bin/env bats

load test_helper/common-setup

# ── basic rename ──────────────────────────────────────────────────

@test "arb rebranch renames branch in all repos and updates config" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # Config updated
    grep -q "branch = feat/new-name" "$TEST_DIR/project/my-feature/.arbws/config"
    # rebranch_from cleared on success
    ! grep -q "rebranch_from" "$TEST_DIR/project/my-feature/.arbws/config"
    # Both repos on new branch
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
}

@test "arb rebranch shows renamed repos in output" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Renamed"* ]]
}

@test "arb rebranch preserves base in config" {
    arb create my-feature repo-a --base main >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    grep -q "base = main" "$TEST_DIR/project/my-feature/.arbws/config"
}

# ── no-op guard ───────────────────────────────────────────────────

@test "arb rebranch same-name is a no-op" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch my-feature --yes --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"nothing to do"* ]]
}

# ── validation ────────────────────────────────────────────────────

@test "arb rebranch rejects invalid branch name" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch "invalid..name" --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid branch name"* ]]
}

@test "arb rebranch outside workspace fails" {
    cd "$TEST_DIR/project"
    run arb rebranch feat/new-name
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

@test "arb rebranch without new-branch arg fails" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"required"* ]]
}

# ── dry-run ───────────────────────────────────────────────────────

@test "arb rebranch --dry-run shows plan without changes" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run"* ]]
    # Config not changed
    grep -q "branch = my-feature" "$TEST_DIR/project/my-feature/.arbws/config"
    # Branch not renamed
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "my-feature" ]
}

# ── already-on-new ────────────────────────────────────────────────

@test "arb rebranch skips repos already on new branch" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Manually rename repo-a to the target branch
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-b should be renamed, repo-a was already there
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    [[ "$output" == *"already renamed"* ]]
}

# ── skip-missing ─────────────────────────────────────────────────

@test "arb rebranch skips repos where old branch is absent" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Manually switch repo-b to a different branch so the expected branch is gone
    git -C "$TEST_DIR/project/my-feature/repo-b" checkout -b other-branch >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" branch -D my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-a renamed, repo-b skipped
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [[ "$output" == *"skip"* ]]
}

# ── skip-in-progress ─────────────────────────────────────────────

@test "arb rebranch skips repos with in-progress git operation" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Workspace repos are linked worktrees — .git is a file, not a directory.
    # Use git rev-parse --git-dir to find the actual git dir for this worktree.
    local wt_a="$TEST_DIR/project/my-feature/repo-a"
    local git_dir
    git_dir=$(git -C "$wt_a" rev-parse --git-dir)
    [[ "$git_dir" = /* ]] || git_dir="$wt_a/$git_dir"
    touch "$git_dir/MERGE_HEAD"

    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-a skipped, repo-b renamed
    [ "$(git -C "$wt_a" branch --show-current)" = "my-feature" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    [[ "$output" == *"in progress"* ]]
    rm -f "$git_dir/MERGE_HEAD"
}

@test "arb rebranch --include-in-progress renames repos with in-progress operations" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    local wt_a="$TEST_DIR/project/my-feature/repo-a"
    local git_dir
    git_dir=$(git -C "$wt_a" rev-parse --git-dir)
    [[ "$git_dir" = /* ]] || git_dir="$wt_a/$git_dir"
    touch "$git_dir/MERGE_HEAD"

    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch --include-in-progress
    [ "$status" -eq 0 ]
    # Both repos renamed despite in-progress op in repo-a
    [ "$(git -C "$wt_a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    rm -f "$git_dir/MERGE_HEAD"
}

# ── migration state ───────────────────────────────────────────────

@test "arb rebranch --continue resumes partial rename" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Simulate partial failure: config updated but repo-b not yet renamed
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
rebranch_from = my-feature
EOF
    # repo-a already renamed, repo-b still on old branch
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebranch --continue --yes --no-fetch
    [ "$status" -eq 0 ]
    # Both repos now on new branch
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    # Migration state cleared
    ! grep -q "rebranch_from" "$TEST_DIR/project/my-feature/.arbws/config"
}

@test "arb rebranch --abort rolls back partial rename" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Simulate partial rename: repo-a done, repo-b still on old
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
rebranch_from = my-feature
EOF
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebranch --abort --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-a rolled back, repo-b unchanged (already on old)
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "my-feature" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "my-feature" ]
    # Config restored
    grep -q "branch = my-feature" "$TEST_DIR/project/my-feature/.arbws/config"
    ! grep -q "rebranch_from" "$TEST_DIR/project/my-feature/.arbws/config"
}

@test "arb rebranch --abort without migration state fails" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch --abort --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"No rebranch in progress"* ]]
}

@test "arb rebranch --continue without migration state fails" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch --continue --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"No rebranch in progress"* ]]
}

@test "arb rebranch blocks conflicting rename when migration is in progress" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Simulate migration in progress toward feat/new-name
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
rebranch_from = my-feature
EOF
    cd "$TEST_DIR/project/my-feature"
    # Try to start a rename to a DIFFERENT target
    run arb rebranch feat/other-name --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"already in progress"* ]]
}

@test "arb rebranch with same target as in-progress treats as resume" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Simulate partial: repo-a done, repo-b still on old
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
rebranch_from = my-feature
EOF
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Same target as in-progress = resume
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
}

# ── --abort dry-run ───────────────────────────────────────────────

@test "arb rebranch --abort --dry-run shows plan without changes" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
rebranch_from = my-feature
EOF
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebranch --abort --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run"* ]]
    # Nothing changed
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    grep -q "rebranch_from" "$TEST_DIR/project/my-feature/.arbws/config"
}

# ── remote ────────────────────────────────────────────────────────

@test "arb rebranch --delete-remote-old deletes old remote branch" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Push the old branch to remote first
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Verify it exists
    git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --delete-remote-old
    [ "$status" -eq 0 ]
    # Old remote branch deleted
    ! git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify my-feature >/dev/null 2>&1
    # Local branch renamed
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
}

@test "arb rebranch warns when old remote branch exists and --delete-remote-old not used" {
    arb create my-feature repo-a >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"still exists"* ]]
    # Old remote branch NOT deleted
    git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify my-feature >/dev/null 2>&1
}

# ── local repo ───────────────────────────────────────────────────

@test "arb rebranch works with local-only repos (no remote)" {
    setup_local_repo
    arb create my-feature repo-a local-lib >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebranch feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/local-lib" branch --show-current)" = "feat/new-name" ]
}
