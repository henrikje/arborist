#!/usr/bin/env bats

load test_helper/common-setup

# ── non-workspace directory cleanup ─────────────────────────────

@test "arb clean --yes removes non-workspace directories" {
    mkdir -p "$TEST_DIR/project/leftover/.idea"
    mkdir -p "$TEST_DIR/project/empty-dir"
    run arb clean --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/leftover" ]
    [ ! -d "$TEST_DIR/project/empty-dir" ]
    [[ "$output" == *"Removed 2 directories"* ]]
}

@test "arb clean --dry-run shows but does not remove" {
    mkdir -p "$TEST_DIR/project/leftover/.idea"
    run arb clean --dry-run
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/leftover" ]
    [[ "$output" == *"leftover"* ]]
    [[ "$output" == *"Dry run"* ]]
}

@test "arb clean with no debris shows nothing-to-clean message" {
    run arb clean --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Nothing to clean up"* ]]
}

@test "arb clean <name> --yes removes only named directories" {
    mkdir -p "$TEST_DIR/project/remove-me"
    mkdir -p "$TEST_DIR/project/keep-me"
    run arb clean remove-me --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/remove-me" ]
    [ -d "$TEST_DIR/project/keep-me" ]
    [[ "$output" == *"Removed 1 directory"* ]]
}

@test "arb clean <workspace-name> errors with guidance to use arb delete" {
    run arb create my-ws -a
    [ "$status" -eq 0 ]
    run arb clean my-ws --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"is a workspace"* ]]
    [[ "$output" == *"arb delete"* ]]
}

@test "arb clean without --yes fails in non-TTY" {
    mkdir -p "$TEST_DIR/project/leftover"
    run arb clean </dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not a terminal"* ]]
}

@test "arb clean shows content descriptions correctly" {
    # empty directory
    mkdir -p "$TEST_DIR/project/empty-dir"
    # single entry directory
    mkdir -p "$TEST_DIR/project/idea-only/.idea"
    # multiple entries directory
    mkdir -p "$TEST_DIR/project/multi-item"
    touch "$TEST_DIR/project/multi-item/file1.txt"
    touch "$TEST_DIR/project/multi-item/file2.txt"
    mkdir -p "$TEST_DIR/project/multi-item/subdir"

    run arb clean --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"empty-dir"* ]]
    [[ "$output" == *"empty"* ]]
    [[ "$output" == *"idea-only"* ]]
    [[ "$output" == *"only .idea/"* ]]
    [[ "$output" == *"multi-item"* ]]
    [[ "$output" == *"3 items"* ]]
}

# ── .arbignore ──────────────────────────────────────────────────

@test "directories in .arbignore are excluded from arb clean" {
    mkdir -p "$TEST_DIR/project/leftover"
    mkdir -p "$TEST_DIR/project/keep-this"
    echo "keep-this" > "$TEST_DIR/project/.arbignore"
    run arb clean --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/leftover" ]
    [ -d "$TEST_DIR/project/keep-this" ]
    [[ "$output" == *"Removed 1 directory"* ]]
}

@test ".arbignore with comments and empty lines works correctly" {
    mkdir -p "$TEST_DIR/project/leftover"
    mkdir -p "$TEST_DIR/project/ignored-dir"
    printf "# This is a comment\n\nignored-dir\n\n# Another comment\n" > "$TEST_DIR/project/.arbignore"
    run arb clean --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/leftover" ]
    [ -d "$TEST_DIR/project/ignored-dir" ]
}

@test "arb clean --dry-run notes .arbignore exclusions" {
    mkdir -p "$TEST_DIR/project/leftover"
    mkdir -p "$TEST_DIR/project/ignored-a"
    mkdir -p "$TEST_DIR/project/ignored-b"
    printf "ignored-a\nignored-b\n" > "$TEST_DIR/project/.arbignore"
    run arb clean --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"2 directories excluded by .arbignore"* ]]
}

# ── git cleanup ─────────────────────────────────────────────────

@test "arb clean --yes prunes stale worktree refs" {
    # Create a workspace, then manually remove its directory to leave stale refs
    run arb create stale-ws -a
    [ "$status" -eq 0 ]
    rm -rf "$TEST_DIR/project/stale-ws"

    # Verify stale refs exist
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" worktree list
    [[ "$output" == *"stale-ws"* ]]

    run arb clean --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"pruned"* ]]

    # Verify stale refs are gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" worktree list
    [[ "$output" != *"stale-ws"* ]]
}

@test "arb clean --yes removes orphaned local branches" {
    # Create a workspace so the branch exists in canonical repos
    run arb create orphan-test -a
    [ "$status" -eq 0 ]

    # Delete the workspace properly to clean up worktrees but leave branches
    # We'll simulate by removing worktree refs but keeping the branch
    rm -rf "$TEST_DIR/project/orphan-test"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" worktree prune
    git -C "$TEST_DIR/project/.arb/repos/repo-b" worktree prune

    # Verify branches still exist
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "orphan-test"
    [[ "$output" == *"orphan-test"* ]]

    run arb clean --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"orphaned branch"* ]]

    # Verify branches are gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "orphan-test"
    [[ -z "$output" || "$output" != *"orphan-test"* ]]
}

@test "arb clean --yes skips unmerged orphaned branches without --force" {
    # Create a workspace and add a commit so the branch has unmerged work
    run arb create unmerged-test -a
    [ "$status" -eq 0 ]
    echo "unmerged content" > "$TEST_DIR/project/unmerged-test/repo-a/unmerged.txt"
    git -C "$TEST_DIR/project/unmerged-test/repo-a" add unmerged.txt
    git -C "$TEST_DIR/project/unmerged-test/repo-a" commit -m "unmerged work"

    # Remove workspace directory and prune worktrees to leave orphaned branches
    rm -rf "$TEST_DIR/project/unmerged-test"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" worktree prune
    git -C "$TEST_DIR/project/.arb/repos/repo-b" worktree prune

    run arb clean --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"skipped"* ]]
    [[ "$output" == *"--force"* ]]

    # Unmerged branch in repo-a should still exist
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "unmerged-test"
    [[ "$output" == *"unmerged-test"* ]]
}

@test "arb clean --yes --force deletes unmerged orphaned branches" {
    # Create a workspace and add a commit
    run arb create force-test -a
    [ "$status" -eq 0 ]
    echo "force content" > "$TEST_DIR/project/force-test/repo-a/force.txt"
    git -C "$TEST_DIR/project/force-test/repo-a" add force.txt
    git -C "$TEST_DIR/project/force-test/repo-a" commit -m "force work"

    # Remove workspace and prune
    rm -rf "$TEST_DIR/project/force-test"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" worktree prune
    git -C "$TEST_DIR/project/.arb/repos/repo-b" worktree prune

    run arb clean --yes --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"orphaned branch"* ]]

    # Branch should be gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "force-test"
    [[ -z "$output" || "$output" != *"force-test"* ]]
}

@test "arb clean --dry-run shows merge status annotations" {
    # Create a merged orphan (no extra commits)
    run arb create merged-orphan -a
    [ "$status" -eq 0 ]
    rm -rf "$TEST_DIR/project/merged-orphan"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" worktree prune
    git -C "$TEST_DIR/project/.arb/repos/repo-b" worktree prune

    # Create an unmerged orphan (with a commit)
    run arb create unmerged-orphan -a
    [ "$status" -eq 0 ]
    echo "orphan work" > "$TEST_DIR/project/unmerged-orphan/repo-a/orphan.txt"
    git -C "$TEST_DIR/project/unmerged-orphan/repo-a" add orphan.txt
    git -C "$TEST_DIR/project/unmerged-orphan/repo-a" commit -m "orphan work"
    rm -rf "$TEST_DIR/project/unmerged-orphan"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" worktree prune
    git -C "$TEST_DIR/project/.arb/repos/repo-b" worktree prune

    run arb clean --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"(merged)"* ]]
    [[ "$output" == *"ahead)"* ]]
}

@test "arb clean does not remove branches belonging to existing workspaces" {
    run arb create active-ws -a
    [ "$status" -eq 0 ]

    # Verify branches exist
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "active-ws"
    [[ "$output" == *"active-ws"* ]]

    run arb clean --yes
    [ "$status" -eq 0 ]

    # Branches should still exist
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "active-ws"
    [[ "$output" == *"active-ws"* ]]
}

@test "arb clean does not remove the default branch from canonical repos" {
    # Verify main branch exists (left by git clone)
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "main"
    [[ "$output" == *"main"* ]]

    # Create a non-workspace dir so arb clean has something to do
    mkdir -p "$TEST_DIR/project/leftover"
    run arb clean --yes
    [ "$status" -eq 0 ]

    # Default branch must survive
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" branch --list "main"
    [[ "$output" == *"main"* ]]
    run git -C "$TEST_DIR/project/.arb/repos/repo-b" branch --list "main"
    [[ "$output" == *"main"* ]]
}

# ── detection hint in arb delete ────────────────────────────────

@test "arb delete hints when non-workspace directories exist" {
    run arb create hint-ws -a
    [ "$status" -eq 0 ]
    mkdir -p "$TEST_DIR/project/leftover-shell"
    run arb delete hint-ws --yes --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"non-workspace director"* ]]
    [[ "$output" == *"arb clean"* ]]
}

@test "arb delete does not hint when no non-workspace directories exist" {
    run arb create no-hint-ws -a
    [ "$status" -eq 0 ]
    run arb delete no-hint-ws --yes --force
    [ "$status" -eq 0 ]
    [[ "$output" != *"arb clean"* ]]
}
