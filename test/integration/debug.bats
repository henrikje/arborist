#!/usr/bin/env bats

load test_helper/common-setup

# ── --debug flag ─────────────────────────────────────────────────

@test "arb --debug status logs git calls to stderr" {
    run arb create debug-ws -a
    [ "$status" -eq 0 ]
    cd "$TEST_DIR/project/debug-ws/repo-a"
    run arb --debug status --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"[git]"* ]]
    [[ "$output" == *"exit 0"* ]]
}

@test "arb --debug logs arb root" {
    run arb create debug-root-ws -a
    [ "$status" -eq 0 ]
    cd "$TEST_DIR/project/debug-root-ws/repo-a"
    run arb --debug status --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"[debug]"* ]]
    [[ "$output" == *"arb root:"* ]]
}

@test "arb --debug logs workspace" {
    run arb create debug-ws-ws -a
    [ "$status" -eq 0 ]
    cd "$TEST_DIR/project/debug-ws-ws/repo-a"
    run arb --debug status --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"workspace: debug-ws-ws"* ]]
}

@test "arb --debug prints git call count summary" {
    run arb create debug-count-ws -a
    [ "$status" -eq 0 ]
    cd "$TEST_DIR/project/debug-count-ws/repo-a"
    run arb --debug status --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"git call"* ]]
}

# ── ARB_DEBUG env var ────────────────────────────────────────────

@test "ARB_DEBUG=1 activates debug output" {
    run arb create debug-env-ws -a
    [ "$status" -eq 0 ]
    cd "$TEST_DIR/project/debug-env-ws/repo-a"
    ARB_DEBUG=1 run arb status --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"[git]"* ]]
}

# ── debug off by default ────────────────────────────────────────

@test "arb status without --debug does not log git calls" {
    run arb create debug-off-ws -a
    [ "$status" -eq 0 ]
    cd "$TEST_DIR/project/debug-off-ws/repo-a"
    run arb status --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" != *"[git]"* ]]
    [[ "$output" != *"[debug]"* ]]
}

# ── debug on error paths ────────────────────────────────────────

@test "arb --debug prints summary even on error" {
    cd /tmp
    run arb --debug status
    [ "$status" -ne 0 ]
    [[ "$output" == *"git call"* ]]
}
