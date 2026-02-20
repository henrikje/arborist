#!/usr/bin/env bats

load test_helper/common-setup

# Path to the bash shell integration file (relative to repo root)
SHELL_FILE="$BATS_TEST_DIRNAME/../shell/arb.bash"

# ── wrapper function ─────────────────────────────────────────────

@test "bash wrapper: arb cd captures path and changes directory" {
    arb create my-feature repo-a
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        arb cd my-feature
        echo \"\$PWD\"
    "
    [ "$status" -eq 0 ]
    [[ "${lines[-1]}" == "$TEST_DIR/project/my-feature" ]]
}

@test "bash wrapper: arb cd with subpath changes to worktree" {
    arb create my-feature repo-a
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        arb cd my-feature/repo-a
        echo \"\$PWD\"
    "
    [ "$status" -eq 0 ]
    [[ "${lines[-1]}" == "$TEST_DIR/project/my-feature/repo-a" ]]
}

@test "bash wrapper: arb create captures path and changes directory" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        arb create new-ws repo-a 2>/dev/null
        echo \"\$PWD\"
    "
    [ "$status" -eq 0 ]
    [[ "${lines[-1]}" == "$TEST_DIR/project/new-ws" ]]
}

@test "bash wrapper: arb cd --help passes through without capturing" {
    arb create my-feature repo-a
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        arb cd --help 2>&1
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage"* ]]
}

@test "bash wrapper: arb create --help passes through without capturing" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        arb create --help 2>&1
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage"* ]]
}

@test "bash wrapper: non-cd/create commands pass through to binary" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        arb repo list
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
}

@test "bash wrapper: deleted PWD recovery" {
    arb create tmp-ws repo-a
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project/tmp-ws/repo-a'
        rm -rf '$TEST_DIR/project/tmp-ws'
        arb --version
        echo \"\$PWD\"
    "
    [ "$status" -eq 0 ]
    # PWD should have recovered to an existing parent directory
    [[ "${lines[-1]}" != "$TEST_DIR/project/tmp-ws/repo-a" ]]
    [ -d "${lines[-1]}" ]
}

# ── completion: subcommands ──────────────────────────────────────

@test "bash completion: completes subcommand names" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb cr)
        COMP_CWORD=1
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"create"* ]]
}

@test "bash completion: completes all subcommands on empty input" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb '')
        COMP_CWORD=1
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"init"* ]]
    [[ "$output" == *"create"* ]]
    [[ "$output" == *"status"* ]]
    [[ "$output" == *"cd"* ]]
    [[ "$output" == *"repo"* ]]
    [[ "$output" == *"template"* ]]
}

# ── completion: workspace names ──────────────────────────────────

@test "bash completion: cd completes workspace names" {
    arb create ws-alpha repo-a
    arb create ws-beta repo-b
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb cd ws-)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-alpha/"* ]]
    [[ "$output" == *"ws-beta/"* ]]
}

@test "bash completion: remove completes workspace names" {
    arb create ws-one repo-a
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb remove ws)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
}

# ── completion: repo names ───────────────────────────────────────

@test "bash completion: create completes repo names" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb create my-feature repo)
        COMP_CWORD=3
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "bash completion: add completes repo names" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project/my-feature'
        COMP_WORDS=(arb add repo)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

# ── completion: flags ────────────────────────────────────────────

@test "bash completion: status completes flags" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb status --)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"--dirty"* ]]
    [[ "$output" == *"--fetch"* ]]
    [[ "$output" == *"--verbose"* ]]
    [[ "$output" == *"--json"* ]]
}

@test "bash completion: push completes flags" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb push --)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"--force"* ]]
    [[ "$output" == *"--yes"* ]]
    [[ "$output" == *"--dry-run"* ]]
}

# ── completion: nested subcommands ───────────────────────────────

@test "bash completion: repo completes subcommands" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb repo '')
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"clone"* ]]
    [[ "$output" == *"list"* ]]
}

@test "bash completion: template completes subcommands" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb template '')
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"add"* ]]
    [[ "$output" == *"remove"* ]]
    [[ "$output" == *"list"* ]]
    [[ "$output" == *"diff"* ]]
    [[ "$output" == *"apply"* ]]
}

# ── completion: scope-aware cd ───────────────────────────────────

@test "bash completion: cd inside workspace completes worktree names" {
    arb create my-feature repo-a repo-b
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project/my-feature'
        COMP_WORDS=(arb cd repo)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "bash completion: cd inside workspace also completes workspace names" {
    arb create ws-alpha repo-a
    arb create ws-beta repo-b
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project/ws-alpha'
        COMP_WORDS=(arb cd ws-)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-alpha/"* ]]
    [[ "$output" == *"ws-beta/"* ]]
}

@test "bash wrapper: arb cd with worktree name changes directory when inside workspace" {
    arb create my-feature repo-a repo-b
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project/my-feature/repo-a'
        arb cd repo-b
        echo \"\$PWD\"
    "
    [ "$status" -eq 0 ]
    [[ "${lines[-1]}" == "$TEST_DIR/project/my-feature/repo-b" ]]
}

# ── completion: cd slash pattern ─────────────────────────────────

@test "bash completion: cd completes repo names after workspace/" {
    arb create my-feature repo-a repo-b
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb cd my-feature/)
        COMP_CWORD=2
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-feature/repo-a"* ]]
    [[ "$output" == *"my-feature/repo-b"* ]]
}

# ── completion: global flags ─────────────────────────────────────

@test "bash completion: completes global flags" {
    run bash -c "
        source '$SHELL_FILE'
        cd '$TEST_DIR/project'
        COMP_WORDS=(arb -)
        COMP_CWORD=1
        _arb
        echo \"\${COMPREPLY[*]}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"-C"* ]]
    [[ "$output" == *"--help"* ]]
    [[ "$output" == *"--version"* ]]
}
