#!/usr/bin/env bats

load test_helper/common-setup

# ── basic output ──────────────────────────────────────────────────

@test "arb branch shows branch name" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb branch
    [ "$status" -eq 0 ]
    [[ "$output" == *"BRANCH"* ]]
    [[ "$output" == *"my-feature"* ]]
}

@test "arb branch shows base when configured" {
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a
    cd "$TEST_DIR/project/stacked"
    run arb branch
    [ "$status" -eq 0 ]
    [[ "$output" == *"BRANCH"* ]]
    [[ "$output" == *"BASE"* ]]
    [[ "$output" == *"feat/auth-ui"* ]]
    [[ "$output" == *"feat/auth"* ]]
}

@test "arb branch does not show BASE column without base" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb branch
    [ "$status" -eq 0 ]
    [[ "$output" != *"BASE"* ]]
}

# ── quiet mode ────────────────────────────────────────────────────

@test "arb branch -q outputs just the branch name" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb branch -q
    [ "$status" -eq 0 ]
    [ "$output" = "my-feature" ]
}

# ── json mode ─────────────────────────────────────────────────────

@test "arb branch --json outputs valid JSON with branch, base, and repos" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb branch --json
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.branch == "my-feature"'
    echo "$output" | jq -e '.base == null'
    echo "$output" | jq -e '.repos | length == 2'
    echo "$output" | jq -e '.repos[0].branch == "my-feature"'
}

# ── deviations ────────────────────────────────────────────────────

@test "arb branch detects drifted repo" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Repos on a different branch"* ]]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"experiment"* ]]
}

@test "arb branch detects detached repo" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout --detach >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb branch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Repos on a different branch"* ]]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"(detached)"* ]]
}

# ── error handling ────────────────────────────────────────────────

@test "arb branch outside a workspace errors" {
    cd "$TEST_DIR/project"
    run arb branch
    [ "$status" -eq 1 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}
