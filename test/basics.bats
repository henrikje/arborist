#!/usr/bin/env bats

load test_helper/common-setup

# ── version & help ───────────────────────────────────────────────

@test "arb --version outputs version number" {
    run arb --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^Arborist\ [0-9]+\.[0-9]+\.[0-9]+ ]]
}

@test "arb version is treated as unknown command" {
    run arb version
    [ "$status" -ne 0 ]
}

@test "arb -v outputs version number" {
    run arb -v
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^Arborist\ [0-9]+\.[0-9]+\.[0-9]+ ]]
}

# ── bare arb (shows help) ────────────────────────────────────────

@test "bare arb shows help with usage and commands" {
    run arb
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"Commands:"* ]]
}

# ── repos ─────────────────────────────────────────────────────────

@test "arb repos lists cloned repo names" {
    run arb repos
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb repos outputs one repo per line" {
    run arb repos
    [ "$status" -eq 0 ]
    local count
    count="$(echo "$output" | wc -l | tr -d ' ')"
    [ "$count" -eq 2 ]
}

@test "arb repos outside arb root fails" {
    cd /tmp
    run arb repos
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside an arb root"* ]]
}

# ── help ──────────────────────────────────────────────────────────

@test "arb help shows full usage text" {
    run arb help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"repos"* ]]
}

@test "arb --help shows usage" {
    run arb --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "arb -h shows usage" {
    run arb -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "unknown command shows error" {
    run arb nonsense
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown command"* ]]
}

@test "commands outside arb root fail with helpful message" {
    cd /tmp
    run arb list
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside an arb root"* ]]
}

# ── init ─────────────────────────────────────────────────────────

@test "arb init creates .arb/repos/" {
    local dir="$TEST_DIR/fresh"
    mkdir -p "$dir"
    cd "$dir"
    run arb init
    [ "$status" -eq 0 ]
    [ -d "$dir/.arb" ]
    [ -d "$dir/.arb/repos" ]
    [[ "$output" == *"arb clone"* ]]
    [[ "$output" == *"arb create"* ]]
}

@test "arb init on existing root fails" {
    run arb init
    [ "$status" -ne 0 ]
    [[ "$output" == *"Already initialized"* ]]
}

@test "arb init inside workspace fails" {
    run arb create ws-init-test -a
    [ "$status" -eq 0 ]
    cd "$TEST_DIR/project/ws-init-test/repo-a"
    run arb init
    [ "$status" -ne 0 ]
    [[ "$output" == *"inside existing arb root"* ]]
}

@test "arb init with path inside arb root fails" {
    run arb init "$TEST_DIR/project/some-subdir"
    [ "$status" -ne 0 ]
    [[ "$output" == *"inside existing arb root"* ]]
}

# ── clone ────────────────────────────────────────────────────────

@test "arb clone clones a repo into repos/" {
    run arb clone "$TEST_DIR/origin/repo-a.git" clone-test
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/clone-test/.git" ]
}

@test "arb clone derives name from URL" {
    git init --bare "$TEST_DIR/origin/derived-name.git" -b main >/dev/null 2>&1
    run arb clone "$TEST_DIR/origin/derived-name.git"
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/derived-name/.git" ]
}

@test "arb clone detaches HEAD in canonical repo" {
    run arb clone "$TEST_DIR/origin/repo-a.git" detach-test
    [ "$status" -eq 0 ]
    run git -C "$TEST_DIR/project/.arb/repos/detach-test" status
    [[ "$output" == *"HEAD detached"* ]]
}

@test "arb clone allows workspace on default branch" {
    run arb clone "$TEST_DIR/origin/repo-a.git" main-test
    [ "$status" -eq 0 ]
    # Creating a workspace on main should succeed because HEAD is detached
    run arb create main-ws --branch main main-test
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/main-ws/main-test" ]
    local branch
    branch="$(git -C "$TEST_DIR/project/main-ws/main-test" branch --show-current)"
    [ "$branch" = "main" ]
}

@test "arb clone fails if repo already exists" {
    run arb clone "$TEST_DIR/origin/repo-a.git" repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"already cloned"* ]]
}

@test "arb clone fails with invalid path" {
    run arb clone "/nonexistent/path/repo.git"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Clone failed"* ]]
}

@test "arb clone without args fails" {
    run arb clone
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing required argument"* ]]
}

