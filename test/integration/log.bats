#!/usr/bin/env bats

load test_helper/common-setup

# ── default mode (feature branch commits) ────────────────────────

@test "arb log shows feature branch commits" {
    arb create my-feature repo-a repo-b
    echo "change-a" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Add feature to repo-a" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    # Use --json to verify structure
    run arb log --json
    [ "$status" -eq 0 ]
    local total
    total="$(echo "$output" | jq '.totalCommits')"
    [ "$total" -eq 1 ]
    local subject
    subject="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .commits[0].subject')"
    [ "$subject" = "Add feature to repo-a" ]
    # repo-b should have 0 commits
    local repo_b_count
    repo_b_count="$(echo "$output" | jq '.repos[] | select(.name == "repo-b") | .commits | length')"
    [ "$repo_b_count" -eq 0 ]
}

@test "arb log shows no commits ahead of base for clean repos" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    local total
    total="$(echo "$output" | jq '.totalCommits')"
    [ "$total" -eq 0 ]
    local count
    count="$(echo "$output" | jq '.repos[0].commits | length')"
    [ "$count" -eq 0 ]
}

@test "arb log shows multiple commits" {
    arb create my-feature repo-a
    echo "one" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "First commit" >/dev/null 2>&1
    echo "two" > "$TEST_DIR/project/my-feature/repo-a/file2.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file2.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Second commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    local count
    count="$(echo "$output" | jq '.repos[0].commits | length')"
    [ "$count" -eq 2 ]
    # Verify both subjects present
    echo "$output" | jq -e '.repos[0].commits[] | select(.subject == "First commit")' >/dev/null
    echo "$output" | jq -e '.repos[0].commits[] | select(.subject == "Second commit")' >/dev/null
}

# ── positional repo filtering ────────────────────────────────────

@test "arb log with positional args filters repos" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Change in repo-a" >/dev/null 2>&1
    echo "change" > "$TEST_DIR/project/my-feature/repo-b/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "Change in repo-b" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb log repo-a --json
    [ "$status" -eq 0 ]
    # Should only include repo-a
    local repo_count
    repo_count="$(echo "$output" | jq '.repos | length')"
    [ "$repo_count" -eq 1 ]
    local repo_name
    repo_name="$(echo "$output" | jq -r '.repos[0].name')"
    [ "$repo_name" = "repo-a" ]
}

@test "arb log with invalid repo name errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb log nonexistent
    [ "$status" -ne 0 ]
    [[ "$output" == *"not in this workspace"* ]]
}

# ── --max-count / -n ─────────────────────────────────────────────

@test "arb log -n 0 rejects invalid max-count" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb log -n 0
    [ "$status" -ne 0 ]
    [[ "$output" == *"--max-count must be a positive integer"* ]]
}

@test "arb log -n abc rejects non-numeric max-count" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb log -n abc
    [ "$status" -ne 0 ]
    [[ "$output" == *"--max-count must be a positive integer"* ]]
}

@test "arb log -n limits commits per repo" {
    arb create my-feature repo-a
    for i in 1 2 3 4 5; do
        echo "$i" > "$TEST_DIR/project/my-feature/repo-a/file$i.txt"
        git -C "$TEST_DIR/project/my-feature/repo-a" add "file$i.txt" >/dev/null 2>&1
        git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Commit $i" >/dev/null 2>&1
    done
    cd "$TEST_DIR/project/my-feature"
    run arb log -n 2 --json
    [ "$status" -eq 0 ]
    local count
    count="$(echo "$output" | jq '.repos[0].commits | length')"
    [ "$count" -eq 2 ]
    # Most recent commits should be shown
    echo "$output" | jq -e '.repos[0].commits[] | select(.subject == "Commit 5")' >/dev/null
    echo "$output" | jq -e '.repos[0].commits[] | select(.subject == "Commit 4")' >/dev/null
}

# ── --json mode ──────────────────────────────────────────────────

@test "arb log --json outputs valid JSON with all fields" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "JSON test commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    # Validate JSON structure
    echo "$output" | jq -e '.workspace' >/dev/null
    echo "$output" | jq -e '.branch' >/dev/null
    echo "$output" | jq -e '.repos' >/dev/null
    echo "$output" | jq -e '.totalCommits' >/dev/null
    # Check repo-a has the commit
    local subject
    subject="$(echo "$output" | jq -r '.repos[0].commits[0].subject')"
    [ "$subject" = "JSON test commit" ]
    # Check full hash is present (40 chars)
    local hash
    hash="$(echo "$output" | jq -r '.repos[0].commits[0].hash')"
    [ "${#hash}" -eq 40 ]
}

@test "arb log --json includes status field per repo" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[0].status')"
    [ "$repo_status" = "ok" ]
}

@test "arb log --json shows empty commits array for repos with no feature commits" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    local count
    count="$(echo "$output" | jq '.repos[0].commits | length')"
    [ "$count" -eq 0 ]
}

# ── edge cases ───────────────────────────────────────────────────

@test "arb log detects detached HEAD" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout --detach HEAD >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .status')"
    [ "$repo_status" = "detached" ]
    local reason
    reason="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .reason')"
    [[ "$reason" == *"detached"* ]]
}

@test "arb log detects drifted branch" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b other-branch >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .status')"
    [ "$repo_status" = "drifted" ]
    local reason
    reason="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .reason')"
    [[ "$reason" == *"other-branch"* ]]
    [[ "$reason" == *"expected my-feature"* ]]
}

@test "arb log skipped repos show warning in pipe mode" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout --detach HEAD >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb log
    [ "$status" -eq 0 ]
    # Pipe mode emits skipped warnings to stderr (captured by run)
    [[ "$output" == *"repo-a: skipped"* ]]
}

@test "arb log shows no-base status for local repo without remote" {
    setup_local_repo
    arb create my-feature local-lib
    echo "change" > "$TEST_DIR/project/my-feature/local-lib/file.txt"
    git -C "$TEST_DIR/project/my-feature/local-lib" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/local-lib" commit -m "Local commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb log --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[0].status')"
    [ "$repo_status" = "no-base" ]
    local reason
    reason="$(echo "$output" | jq -r '.repos[0].reason')"
    [[ "$reason" == *"no base"* ]]
    # Should still show commits (fallback to recent)
    local count
    count="$(echo "$output" | jq '.repos[0].commits | length')"
    [ "$count" -ge 1 ]
}

@test "arb log shows fallback-base when configured base not found" {
    # repo-a has feat/auth branch, repo-b does NOT
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b
    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1
    run arb log --json
    [ "$status" -eq 0 ]
    # repo-a should be ok (base feat/auth exists)
    local repo_a_status
    repo_a_status="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .status')"
    [ "$repo_a_status" = "ok" ]
    # repo-b should be fallback-base (feat/auth doesn't exist, fell back to main)
    local repo_b_status
    repo_b_status="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-b") | .status')"
    [ "$repo_b_status" = "fallback-base" ]
    local repo_b_reason
    repo_b_reason="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-b") | .reason')"
    [[ "$repo_b_reason" == *"feat/auth"* ]]
}

@test "arb log without workspace context fails" {
    run arb log
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

# ── pipe output ──────────────────────────────────────────────────

@test "arb log piped produces tab-separated output" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Piped test commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    # Pipe through cat to force non-TTY mode
    local result
    result="$(arb log | cat)"
    # Should be tab-separated: repo<TAB>hash<TAB>subject
    [[ "$result" == *"repo-a"* ]]
    [[ "$result" == *"Piped test commit"* ]]
    # Should contain tabs
    local tab_count
    tab_count="$(echo "$result" | tr -cd '\t' | wc -c | tr -d ' ')"
    [ "$tab_count" -ge 2 ]
}

@test "arb log pipe omits repos with 0 commits" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Only in repo-a" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    local result
    result="$(arb log | cat)"
    # repo-a should appear, repo-b should not (no commits)
    [[ "$result" == *"repo-a"* ]]
    [[ "$result" != *"repo-b"* ]]
}
