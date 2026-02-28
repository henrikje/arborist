#!/usr/bin/env bats

load test_helper/common-setup

# ── escape-to-cancel background fetch ────────────────────────────

@test "arb status --no-fetch produces output without fetching" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
}

@test "arb list --no-fetch produces output without fetching" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb list --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-feature"* ]]
}

@test "arb status piped to cat produces clean output" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run bash -c 'arb status | cat'
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    # No escape hint in non-TTY output
    [[ "$output" != *"<Esc to cancel>"* ]]
}

@test "arb list piped to cat produces clean output" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run bash -c 'arb list | cat'
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-feature"* ]]
    # No escape hint in non-TTY output
    [[ "$output" != *"<Esc to cancel>"* ]]
}

@test "arb status with piped stdin still works" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run bash -c 'echo "repo-a" | arb status --no-fetch'
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb branch --verbose --no-fetch produces output" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb branch --verbose --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
}
