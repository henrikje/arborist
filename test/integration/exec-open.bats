#!/usr/bin/env bats

load test_helper/common-setup

# ── exec ─────────────────────────────────────────────────────────

@test "arb exec runs in each repo, skips .arbws/" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb exec echo hello
    [[ "$output" == *"==> repo-a <=="* ]]
    [[ "$output" == *"==> repo-b <=="* ]]
    [[ "$output" == *"hello"* ]]
    [[ "$output" != *".arbws"* ]]
}

@test "arb exec pwd runs in each repo directory" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb exec pwd
    [[ "$output" == *"/my-feature/repo-a"* ]]
    [[ "$output" == *"/my-feature/repo-b"* ]]
}

@test "arb exec returns non-zero if any command fails" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb exec false
    [ "$status" -ne 0 ]
}

@test "arb exec without args fails" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb exec
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing required argument"* ]]
}

@test "arb exec with nonexistent command fails cleanly" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb exec nonexistent-command-xyz
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found in PATH"* ]]
}

@test "arb exec without workspace context fails" {
    run arb exec echo hi
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

@test "arb exec --dirty runs only in dirty repos" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb exec --dirty pwd
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb exec -d runs only in dirty repos" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb exec -d pwd
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb exec passes flags through to the command" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/exec-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do printf '%s\n' "$arg"; done >> "$TEST_DIR/exec-args"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb exec "$spy" -d --verbose -x
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/exec-args"
    [[ "$output" == *"-d"* ]]
    [[ "$output" == *"--verbose"* ]]
    [[ "$output" == *"-x"* ]]
}

@test "arb exec combines arb flags with pass-through flags" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/exec-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do printf '%s\n' "$arg"; done >> "$TEST_DIR/exec-args"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb exec --dirty "$spy" -d --verbose
    [ "$status" -eq 0 ]
    # --dirty filtered to repo-a only; -d and --verbose passed through
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
    run cat "$TEST_DIR/exec-args"
    [[ "$output" == *"-d"* ]]
    [[ "$output" == *"--verbose"* ]]
}

# ── open ─────────────────────────────────────────────────────────

@test "arb open opens all worktrees by default with single invocation" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done >> "$TEST_DIR/opened-dirs"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open "$spy"
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-dirs"
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb open invokes editor once with all dirs" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
echo "invocation" >> "$TEST_DIR/invocations"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open "$spy"
    [ "$status" -eq 0 ]
    local count
    count="$(wc -l < "$TEST_DIR/invocations" | tr -d ' ')"
    [ "$count" -eq 1 ]
}

@test "arb open --dirty opens only dirty worktrees" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done >> "$TEST_DIR/opened-dirs"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open --dirty "$spy"
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-dirs"
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb open -d opens only dirty worktrees" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done >> "$TEST_DIR/opened-dirs"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open -d "$spy"
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-dirs"
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb open passes flags through to the command" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do printf '%s\n' "$arg"; done >> "$TEST_DIR/opened-args"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open "$spy" --extra-flag -n
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-args"
    [[ "$output" == *"--extra-flag"* ]]
    [[ "$output" == *"-n"* ]]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb open combines arb flags with pass-through flags" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do printf '%s\n' "$arg"; done >> "$TEST_DIR/opened-args"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open --dirty "$spy" --extra-flag -n
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-args"
    [[ "$output" == *"--extra-flag"* ]]
    [[ "$output" == *"-n"* ]]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb open --dirty shows no match when all clean" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb open --dirty true
    [[ "$output" == *"No worktrees match the filter"* ]]
}

@test "arb open without command fails" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb open
    [ "$status" -ne 0 ]
}

@test "arb open with nonexistent editor fails" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb open nonexistent-editor-xyz
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found in PATH"* ]]
}

# ── -w as --where short form ──────────────────────────────────────

@test "arb status -w dirty filters repos (short for --where)" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    echo "change" >> repo-a/file.txt
    run arb status -w dirty
    [ "$status" -ne 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb -w as global option is rejected" {
    run arb -w dirty status
    [ "$status" -ne 0 ]
}

# ── local repos (no remote) ──────────────────────────────────────

@test "arb create with local repo creates worktree from local default branch" {
    setup_local_repo
    arb create local-ws local-lib
    [ -d "$TEST_DIR/project/local-ws/local-lib" ]
    local branch
    branch="$(git -C "$TEST_DIR/project/local-ws/local-lib" branch --show-current)"
    [ "$branch" = "local-ws" ]
}

@test "arb status shows local for push status on remoteless repos" {
    setup_local_repo
    arb create local-ws local-lib
    cd "$TEST_DIR/project/local-ws"
    run arb status
    # Local-only repos don't count as issues — exit 0
    [ "$status" -eq 0 ]
    [[ "$output" == *"local-lib"* ]]
    [[ "$output" == *"local"* ]]
    [[ "$output" != *"not pushed"* ]]
}

@test "arb fetch skips local repos without error" {
    setup_local_repo
    arb create local-ws local-lib
    cd "$TEST_DIR/project/local-ws"
    run arb fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" == *"skipping"* ]]
}

@test "arb pull skips local repos with informational message" {
    setup_local_repo
    arb create local-ws local-lib
    cd "$TEST_DIR/project/local-ws"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" == *"skipped"* ]]
}

@test "arb delete cleans up local repo without attempting remote operations" {
    setup_local_repo
    arb create local-ws local-lib
    arb delete local-ws --force
    [ ! -d "$TEST_DIR/project/local-ws" ]
    # Branch should be deleted from canonical repo
    run git -C "$TEST_DIR/project/.arb/repos/local-lib" show-ref --verify "refs/heads/local-ws"
    [ "$status" -ne 0 ]
}

@test "mixed workspace with remote and local repos works correctly" {
    setup_local_repo
    arb create mixed-ws repo-a local-lib
    [ -d "$TEST_DIR/project/mixed-ws/repo-a" ]
    [ -d "$TEST_DIR/project/mixed-ws/local-lib" ]

    cd "$TEST_DIR/project/mixed-ws"

    # status works for both (exit 0 — fresh branch with no commits is not unpushed)
    run arb status
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"local-lib"* ]]

    # fetch skips local, fetches remote
    run arb fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" == *"repo-a"* ]]

    # pull skips local
    run arb pull --yes
    [ "$status" -eq 0 ]
}


# ── --dry-run flag ───────────────────────────────────────────────

@test "arb push --dry-run shows plan without pushing" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"1 commit"* ]]
    [[ "$output" == *"to push"* ]]
    [[ "$output" == *"Dry run"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Pushed"* ]]
    # Verify nothing was actually pushed
    run git -C "$TEST_DIR/origin/repo-a.git" branch
    [[ "$output" != *"my-feature"* ]]
}

@test "arb push -n short flag works" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push -n
    [ "$status" -eq 0 ]
    [[ "$output" == *"to push"* ]]
    [[ "$output" == *"Dry run"* ]]
    [[ "$output" != *"Pushed"* ]]
}

@test "arb push --dry-run when up to date shows up to date" {
    arb create my-feature repo-a
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

@test "arb pull --dry-run shows plan without pulling" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a new commit from another clone
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"to pull"* ]]
    [[ "$output" == *"Dry run"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Pulled"* ]]
    # Verify nothing was actually pulled
    [ ! -f "$TEST_DIR/project/my-feature/repo-a/r.txt" ]
}

@test "arb rebase --dry-run shows plan without rebasing" {
    arb create my-feature repo-a

    # Push upstream change so rebase has work to do
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"rebase my-feature onto"* ]]
    [[ "$output" == *"Dry run"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Rebased"* ]]
    # Verify the upstream commit is NOT reachable (rebase didn't happen)
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" != *"upstream"* ]]
}

@test "arb merge --dry-run shows plan without merging" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb merge --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"merge"*"into my-feature"* ]]
    [[ "$output" == *"Dry run"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Merged"* ]]
    # Verify the upstream commit is NOT reachable (merge didn't happen)
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" != *"upstream"* ]]
}

@test "arb delete --dry-run shows status without removing" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project"
    run arb delete my-feature --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-feature"* ]]
    [[ "$output" == *"WORKSPACE"* ]]
    [[ "$output" == *"Dry run"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Deleted"* ]]
    # Verify the workspace still exists
    [ -d "$TEST_DIR/project/my-feature" ]
}

@test "arb delete --all-safe --dry-run shows workspaces without removing" {
    arb create ws-one repo-a
    git -C "$TEST_DIR/project/ws-one/repo-a" push -u origin ws-one >/dev/null 2>&1
    arb create ws-two repo-b
    git -C "$TEST_DIR/project/ws-two/repo-b" push -u origin ws-two >/dev/null 2>&1
    cd "$TEST_DIR/project"
    run arb delete --all-safe --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    [[ "$output" == *"Dry run"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Deleted"* ]]
    # Verify both workspaces still exist
    [ -d "$TEST_DIR/project/ws-one" ]
    [ -d "$TEST_DIR/project/ws-two" ]
}


# ── --where filtering ─────────────────────────────────────────────

@test "arb status --where dirty filters repos" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status --where dirty
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --where gone shows only gone repos" {
    arb create my-feature repo-a repo-b
    # Push repo-a, then delete the remote branch to make it "gone"
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/origin/repo-a.git" branch -D my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" fetch --prune >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status --where gone
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --where dirty --json filters JSON output" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status --where dirty --json
    [ "$status" -ne 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --where invalid shows helpful error" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --where invalid
    [ "$status" -ne 0 ]
    [[ "$output" == *"Unknown filter term: invalid"* ]]
    [[ "$output" == *"Valid terms:"* ]]
}

@test "arb status --where comma-separated uses OR logic" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status --where dirty,gone
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --dirty --where errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --dirty --where dirty
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --dirty with --where"* ]]
}

@test "arb exec --where dirty runs only in dirty repos" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb exec --where dirty pwd
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb exec --dirty still works as shortcut" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb exec --dirty pwd
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb exec --repo runs only in specified repo" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb exec --repo repo-a pwd
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb exec --repo with multiple repos runs in all specified" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb exec --repo repo-a --repo repo-b pwd
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb exec --repo with invalid repo name errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb exec --repo nonexistent pwd
    [ "$status" -ne 0 ]
    [[ "$output" == *"Repo 'nonexistent' is not in this workspace"* ]]
}

@test "arb exec --repo combined with --dirty uses AND logic" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-b/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb exec --repo repo-a --dirty pwd
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb open --repo opens only specified repos" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done >> "$TEST_DIR/opened-dirs"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open --repo repo-a "$spy"
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-dirs"
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb open --repo with multiple repos opens all specified" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done >> "$TEST_DIR/opened-dirs"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open --repo repo-a --repo repo-b "$spy"
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-dirs"
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb open --repo with invalid repo name errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb open --repo nonexistent true
    [ "$status" -ne 0 ]
    [[ "$output" == *"Repo 'nonexistent' is not in this workspace"* ]]
}

@test "arb open --repo combined with --dirty uses AND logic" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-b/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    local spy="$TEST_DIR/editor-spy"
    cat > "$spy" <<'SCRIPT'
#!/usr/bin/env bash
for arg in "$@"; do echo "$arg"; done >> "$TEST_DIR/opened-dirs"
SCRIPT
    chmod +x "$spy"
    export TEST_DIR
    run arb open --repo repo-a --dirty "$spy"
    [ "$status" -eq 0 ]
    run cat "$TEST_DIR/opened-dirs"
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

