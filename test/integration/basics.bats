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

# ── repo list ────────────────────────────────────────────────────

@test "arb repo list lists cloned repo names" {
    run arb repo list
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb repo list outputs header plus one repo per line" {
    run arb repo list
    [ "$status" -eq 0 ]
    local count
    count="$(echo "$output" | wc -l | tr -d ' ')"
    [ "$count" -eq 3 ]
}

@test "arb repo list shows remote URL for each repo" {
    run arb repo list
    [ "$status" -eq 0 ]
    [[ "$output" == *"origin/repo-a.git"* ]]
    [[ "$output" == *"origin/repo-b.git"* ]]
}

@test "arb repo list outside arb root fails" {
    cd /tmp
    run arb repo list
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside an arb root"* ]]
}

# ── help ──────────────────────────────────────────────────────────

@test "arb help shows full usage text" {
    run arb help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"repo"* ]]
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
    [[ "$output" == *"arb repo clone"* ]]
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

# ── repo clone ───────────────────────────────────────────────────

@test "arb repo clone clones a repo into repos/" {
    run arb repo clone "$TEST_DIR/origin/repo-a.git" clone-test
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/clone-test/.git" ]
}

@test "arb repo clone derives name from URL" {
    git init --bare "$TEST_DIR/origin/derived-name.git" -b main >/dev/null 2>&1
    run arb repo clone "$TEST_DIR/origin/derived-name.git"
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/derived-name/.git" ]
}

@test "arb repo clone detaches HEAD in canonical repo" {
    run arb repo clone "$TEST_DIR/origin/repo-a.git" detach-test
    [ "$status" -eq 0 ]
    run git -C "$TEST_DIR/project/.arb/repos/detach-test" status
    [[ "$output" == *"HEAD detached"* ]]
}

@test "arb repo clone allows workspace on default branch" {
    run arb repo clone "$TEST_DIR/origin/repo-a.git" main-test
    [ "$status" -eq 0 ]
    # Creating a workspace on main should succeed because HEAD is detached
    run arb create main-ws --branch main main-test
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/main-ws/main-test" ]
    local branch
    branch="$(git -C "$TEST_DIR/project/main-ws/main-test" branch --show-current)"
    [ "$branch" = "main" ]
}

@test "arb repo clone fails if repo already exists" {
    run arb repo clone "$TEST_DIR/origin/repo-a.git" repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"already cloned"* ]]
}

@test "arb repo clone fails with invalid path" {
    run arb repo clone "/nonexistent/path/repo.git"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Clone failed"* ]]
}

@test "arb repo clone without args fails" {
    run arb repo clone
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing required argument"* ]]
}

# ── repo remove ──────────────────────────────────────────────────

@test "arb repo remove deletes a canonical repo" {
    run arb repo clone "$TEST_DIR/origin/repo-a.git" remove-me
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/remove-me/.git" ]
    run arb repo remove remove-me --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/.arb/repos/remove-me" ]
    [[ "$output" == *"[remove-me] removed"* ]]
    [[ "$output" == *"Removed 1 repo"* ]]
}

@test "arb repo remove cleans up template directory" {
    run arb repo clone "$TEST_DIR/origin/repo-a.git" tpl-rm
    [ "$status" -eq 0 ]
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/tpl-rm"
    echo "content" > "$TEST_DIR/project/.arb/templates/repos/tpl-rm/.env"
    run arb repo remove tpl-rm --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/.arb/templates/repos/tpl-rm" ]
}

@test "arb repo remove refuses when workspace uses repo" {
    run arb create ws-using-repo -a
    [ "$status" -eq 0 ]
    run arb repo remove repo-a --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot remove repo-a"* ]]
    [[ "$output" == *"ws-using-repo"* ]]
    # Repo still exists
    [ -d "$TEST_DIR/project/.arb/repos/repo-a/.git" ]
}

@test "arb repo remove fails for nonexistent repo" {
    run arb repo remove does-not-exist --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"not cloned"* ]]
}

@test "arb repo remove removes multiple repos" {
    run arb repo clone "$TEST_DIR/origin/repo-a.git" multi-a
    [ "$status" -eq 0 ]
    run arb repo clone "$TEST_DIR/origin/repo-b.git" multi-b
    [ "$status" -eq 0 ]
    run arb repo remove multi-a multi-b --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/.arb/repos/multi-a" ]
    [ ! -d "$TEST_DIR/project/.arb/repos/multi-b" ]
    [[ "$output" == *"Removed 2 repos"* ]]
}

@test "arb repo remove --all-repos removes all repos" {
    # Remove the default repos (not used by any workspace)
    run arb repo remove --all-repos --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Removed"* ]]
    run arb repo list
    [ -z "$output" ]
}

@test "arb repo remove without args in non-TTY fails" {
    run arb repo remove </dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"No repos specified"* ]]
}
