#!/usr/bin/env bats

load test_helper/common-setup

# ── basic rename ──────────────────────────────────────────────────

@test "arb branch rename renames branch in all repos and updates config" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # Config updated
    grep -q "branch = feat/new-name" "$TEST_DIR/project/my-feature/.arbws/config"
    # branch_rename_from cleared on success
    ! grep -q "branch_rename_from" "$TEST_DIR/project/my-feature/.arbws/config"
    # Both repos on new branch
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
}

@test "arb branch rename shows renamed repos in output" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Renamed"* ]]
}

@test "arb branch rename preserves base in config" {
    arb create my-feature repo-a --base main >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    grep -q "base = main" "$TEST_DIR/project/my-feature/.arbws/config"
}

# ── no-op guard ───────────────────────────────────────────────────

@test "arb branch rename same-name is a no-op" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename my-feature --yes --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"nothing to do"* ]]
}

# ── validation ────────────────────────────────────────────────────

@test "arb branch rename rejects invalid branch name" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename "invalid..name" --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid branch name"* ]]
}

@test "arb branch rename outside workspace fails" {
    cd "$TEST_DIR/project"
    run arb branch rename feat/new-name
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

@test "arb branch rename without new-name arg fails" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"required"* ]]
}

# ── dry-run ───────────────────────────────────────────────────────

@test "arb branch rename --dry-run shows plan without changes" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run"* ]]
    # Config not changed
    grep -q "branch = my-feature" "$TEST_DIR/project/my-feature/.arbws/config"
    # Branch not renamed
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "my-feature" ]
}

# ── already-on-new ────────────────────────────────────────────────

@test "arb branch rename skips repos already on new branch" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Manually rename repo-a to the target branch
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-b should be renamed, repo-a was already there
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    [[ "$output" == *"already renamed"* ]]
}

# ── skip-missing ─────────────────────────────────────────────────

@test "arb branch rename skips repos where old branch is absent" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Manually switch repo-b to a different branch so the expected branch is gone
    git -C "$TEST_DIR/project/my-feature/repo-b" checkout -b other-branch >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" branch -D my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-a renamed, repo-b skipped
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [[ "$output" == *"skip"* ]]
}

# ── skip-in-progress ─────────────────────────────────────────────

@test "arb branch rename skips repos with in-progress git operation" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Workspace repos are linked worktrees — .git is a file, not a directory.
    # Use git rev-parse --git-dir to find the actual git dir for this worktree.
    local wt_a="$TEST_DIR/project/my-feature/repo-a"
    local git_dir
    git_dir=$(git -C "$wt_a" rev-parse --git-dir)
    [[ "$git_dir" = /* ]] || git_dir="$wt_a/$git_dir"
    touch "$git_dir/MERGE_HEAD"

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-a skipped, repo-b renamed
    [ "$(git -C "$wt_a" branch --show-current)" = "my-feature" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    [[ "$output" == *"in progress"* ]]
    rm -f "$git_dir/MERGE_HEAD"
}

@test "arb branch rename --include-in-progress renames repos with in-progress operations" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    local wt_a="$TEST_DIR/project/my-feature/repo-a"
    local git_dir
    git_dir=$(git -C "$wt_a" rev-parse --git-dir)
    [[ "$git_dir" = /* ]] || git_dir="$wt_a/$git_dir"
    touch "$git_dir/MERGE_HEAD"

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --no-fetch --include-in-progress
    [ "$status" -eq 0 ]
    # Both repos renamed despite in-progress op in repo-a
    [ "$(git -C "$wt_a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    rm -f "$git_dir/MERGE_HEAD"
}

# ── migration state ───────────────────────────────────────────────

@test "arb branch rename --continue resumes partial rename" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Simulate partial failure: config updated but repo-b not yet renamed
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
branch_rename_from = my-feature
EOF
    # repo-a already renamed, repo-b still on old branch
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename --continue --yes --no-fetch
    [ "$status" -eq 0 ]
    # Both repos now on new branch
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
    # Migration state cleared
    ! grep -q "branch_rename_from" "$TEST_DIR/project/my-feature/.arbws/config"
}

@test "arb branch rename --abort rolls back partial rename" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Simulate partial rename: repo-a done, repo-b still on old
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
branch_rename_from = my-feature
EOF
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename --abort --yes --no-fetch
    [ "$status" -eq 0 ]
    # repo-a rolled back, repo-b unchanged (already on old)
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "my-feature" ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "my-feature" ]
    # Config restored
    grep -q "branch = my-feature" "$TEST_DIR/project/my-feature/.arbws/config"
    ! grep -q "branch_rename_from" "$TEST_DIR/project/my-feature/.arbws/config"
}

@test "arb branch rename --abort without migration state fails" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename --abort --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"No rename in progress"* ]]
}

@test "arb branch rename --continue without migration state fails" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename --continue --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"No rename in progress"* ]]
}

@test "arb branch rename blocks conflicting rename when migration is in progress" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Simulate migration in progress toward feat/new-name
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
branch_rename_from = my-feature
EOF
    cd "$TEST_DIR/project/my-feature"
    # Try to start a rename to a DIFFERENT target
    run arb branch rename feat/other-name --yes --no-fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"already in progress"* ]]
}

@test "arb branch rename with same target as in-progress treats as resume" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Simulate partial: repo-a done, repo-b still on old
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
branch_rename_from = my-feature
EOF
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Same target as in-progress = resume
    run arb branch rename feat/new-name --yes --no-fetch
    [ "$status" -eq 0 ]
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)" = "feat/new-name" ]
}

# ── --abort dry-run ───────────────────────────────────────────────

@test "arb branch rename --abort --dry-run shows plan without changes" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = feat/new-name
branch_rename_from = my-feature
EOF
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature feat/new-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename --abort --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run"* ]]
    # Nothing changed
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
    grep -q "branch_rename_from" "$TEST_DIR/project/my-feature/.arbws/config"
}

# ── remote ────────────────────────────────────────────────────────

@test "arb branch rename --delete-remote deletes old remote branch" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Push the old branch to remote first
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Verify it exists
    git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --delete-remote
    [ "$status" -eq 0 ]
    # Old remote branch deleted
    ! git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify my-feature >/dev/null 2>&1
    # Local branch renamed
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "feat/new-name" ]
}

@test "arb branch rename hints about arb push when old remote branch exists" {
    arb create my-feature repo-a >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new-name --yes --keep-workspace-name
    [ "$status" -eq 0 ]
    [[ "$output" == *"arb push"* ]]
    # Old remote branch NOT deleted
    git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify my-feature >/dev/null 2>&1
}

# ── workspace rename ─────────────────────────────────────────────

@test "arb branch rename auto-renames workspace when names match" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # Workspace directory renamed
    [ -d "$TEST_DIR/project/short-name" ]
    [ ! -d "$TEST_DIR/project/my-feature" ]
    # Config at new path
    grep -q "branch = short-name" "$TEST_DIR/project/short-name/.arbws/config"
    # Repos on new branch
    [ "$(git -C "$TEST_DIR/project/short-name/repo-a" branch --show-current)" = "short-name" ]
    [ "$(git -C "$TEST_DIR/project/short-name/repo-b" branch --show-current)" = "short-name" ]
    # Stdout contains new path
    [[ "$output" == *"$TEST_DIR/project/short-name"* ]]
}

@test "arb branch rename warns when branch has slash (invalid workspace name)" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new --yes --no-fetch
    [ "$status" -eq 0 ]
    # Workspace NOT renamed (slash in branch name)
    [ -d "$TEST_DIR/project/my-feature" ]
    [[ "$output" == *"not a valid workspace name"* ]]
    [[ "$output" == *"--workspace-name"* ]]
}

@test "arb branch rename --keep-workspace-name prevents workspace rename" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --yes --no-fetch --keep-workspace-name
    [ "$status" -eq 0 ]
    # Workspace NOT renamed
    [ -d "$TEST_DIR/project/my-feature" ]
    [ ! -d "$TEST_DIR/project/short-name" ]
    # Branch still renamed
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)" = "short-name" ]
}

@test "arb branch rename --workspace-name renames workspace explicitly" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename feat/new --yes --no-fetch --workspace-name feat-new
    [ "$status" -eq 0 ]
    # Workspace renamed to explicit name
    [ -d "$TEST_DIR/project/feat-new" ]
    [ ! -d "$TEST_DIR/project/my-feature" ]
    # Branch renamed
    [ "$(git -C "$TEST_DIR/project/feat-new/repo-a" branch --show-current)" = "feat/new" ]
    # Stdout contains new path
    [[ "$output" == *"$TEST_DIR/project/feat-new"* ]]
}

@test "arb branch rename --workspace-name rejects invalid name" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --yes --no-fetch --workspace-name "bad/name"
    [ "$status" -ne 0 ]
    [[ "$output" == *"must not contain '/'"* ]]
    # Nothing changed
    [ -d "$TEST_DIR/project/my-feature" ]
}

@test "arb branch rename --workspace-name rejects existing directory" {
    arb create my-feature repo-a >/dev/null 2>&1
    arb create other-ws repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --yes --no-fetch --workspace-name other-ws
    [ "$status" -ne 0 ]
    [[ "$output" == *"already exists"* ]]
}

@test "arb branch rename --workspace-name conflicts with --keep-workspace-name" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --yes --no-fetch --workspace-name new-ws --keep-workspace-name
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine"* ]]
}

@test "arb branch rename does not rename workspace when names differ" {
    arb create my-ws -b my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-ws"
    run arb branch rename short-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # Workspace stays because ws name (my-ws) != old branch (my-feature)
    [ -d "$TEST_DIR/project/my-ws" ]
    [ ! -d "$TEST_DIR/project/short-name" ]
    # Branch still renamed
    [ "$(git -C "$TEST_DIR/project/my-ws/repo-a" branch --show-current)" = "short-name" ]
}

@test "arb branch rename warns when target workspace directory exists" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/short-name"
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --yes --no-fetch
    [ "$status" -eq 0 ]
    # Workspace NOT renamed (target exists)
    [ -d "$TEST_DIR/project/my-feature" ]
    [[ "$output" == *"already exists"* ]]
    [[ "$output" == *"--workspace-name"* ]]
}

@test "arb branch rename --dry-run does not rename workspace" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run"* ]]
    # Workspace NOT renamed
    [ -d "$TEST_DIR/project/my-feature" ]
    [ ! -d "$TEST_DIR/project/short-name" ]
}

@test "arb branch rename shows workspace rename in plan" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename short-name --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Renaming workspace"* ]]
}

@test "arb branch rename standalone workspace rename via same branch + --workspace-name" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch rename my-feature --workspace-name new-ws
    [ "$status" -eq 0 ]
    # Workspace renamed
    [ -d "$TEST_DIR/project/new-ws" ]
    [ ! -d "$TEST_DIR/project/my-feature" ]
    # Branch unchanged
    [ "$(git -C "$TEST_DIR/project/new-ws/repo-a" branch --show-current)" = "my-feature" ]
    # Stdout contains new path
    [[ "$output" == *"$TEST_DIR/project/new-ws"* ]]
}

# ── tracking cleanup ─────────────────────────────────────────────

@test "arb branch rename clears tracking so push sees new branch" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Push the old branch to set up tracking
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Verify tracking exists
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" config branch.my-feature.merge)" = "refs/heads/my-feature" ]

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename new-name --yes --keep-workspace-name
    [ "$status" -eq 0 ]

    # Tracking cleared
    ! git -C "$TEST_DIR/project/my-feature/repo-a" config branch.new-name.merge 2>/dev/null
    ! git -C "$TEST_DIR/project/my-feature/repo-a" config branch.new-name.remote 2>/dev/null
}

@test "arb push after branch rename pushes new branch name" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Make a commit so there's something to push
    git -C "$TEST_DIR/project/my-feature/repo-a" commit --allow-empty -m "test commit" >/dev/null 2>&1
    # Push old branch
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb branch rename new-name --yes --keep-workspace-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb push --yes
    [ "$status" -eq 0 ]
    # New remote branch exists
    git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify new-name >/dev/null 2>&1
    # Tracking now points to new branch
    [ "$(git -C "$TEST_DIR/project/my-feature/repo-a" config branch.new-name.merge)" = "refs/heads/new-name" ]
}

@test "arb branch rename clears stale tracking for already-renamed repos" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Push repo-a to set up tracking
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Simulate partial: repo-a manually renamed (tracking still stale)
    git -C "$TEST_DIR/project/my-feature/repo-a" branch -m my-feature new-name >/dev/null 2>&1
    cat > "$TEST_DIR/project/my-feature/.arbws/config" <<EOF
branch = new-name
branch_rename_from = my-feature
EOF

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename --continue --yes --no-fetch
    [ "$status" -eq 0 ]

    # Even repo-a (already renamed) should have tracking cleared
    ! git -C "$TEST_DIR/project/my-feature/repo-a" config branch.new-name.merge 2>/dev/null
}

@test "arb branch rename --delete-remote plus push creates clean remote state" {
    arb create my-feature repo-a >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit --allow-empty -m "test" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb branch rename new-name --yes --delete-remote --keep-workspace-name >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb push --yes
    [ "$status" -eq 0 ]
    # Old remote gone, new remote exists
    ! git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify my-feature 2>/dev/null
    git -C "$TEST_DIR/origin/repo-a.git" rev-parse --verify new-name >/dev/null 2>&1
}

@test "arb branch rename plan shows remote status in REMOTE column" {
    arb create my-feature repo-a >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb branch rename new-name --dry-run --keep-workspace-name
    [ "$status" -eq 0 ]
    [[ "$output" == *"leave"* ]]
    [[ "$output" == *"in place"* ]]
}
