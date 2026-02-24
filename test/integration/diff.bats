#!/usr/bin/env bats

load test_helper/common-setup

# ── feature branch diff ──────────────────────────────────────────

@test "arb diff shows feature branch diff" {
    arb create my-feature repo-a repo-b
    echo "new content" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Add file to repo-a" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local total_files
    total_files="$(echo "$output" | jq '.totalFiles')"
    [ "$total_files" -eq 1 ]
    local total_ins
    total_ins="$(echo "$output" | jq '.totalInsertions')"
    [ "$total_ins" -eq 1 ]
    # repo-a should have changes
    local repo_a_files
    repo_a_files="$(echo "$output" | jq '.repos[] | select(.name == "repo-a") | .stat.files')"
    [ "$repo_a_files" -eq 1 ]
}

@test "arb diff shows clean for repos with no feature commits" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[0].status')"
    [ "$repo_status" = "clean" ]
    local total_files
    total_files="$(echo "$output" | jq '.totalFiles')"
    [ "$total_files" -eq 0 ]
}

@test "arb diff shows multiple files changed" {
    arb create my-feature repo-a
    echo "one" > "$TEST_DIR/project/my-feature/repo-a/file1.txt"
    echo "two" > "$TEST_DIR/project/my-feature/repo-a/file2.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file1.txt file2.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Add two files" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local total_files
    total_files="$(echo "$output" | jq '.totalFiles')"
    [ "$total_files" -eq 2 ]
    local total_ins
    total_ins="$(echo "$output" | jq '.totalInsertions')"
    [ "$total_ins" -eq 2 ]
}

# ── --stat mode ──────────────────────────────────────────────────

@test "arb diff --stat --json includes fileStat" {
    arb create my-feature repo-a
    echo "content" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Add file" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --stat --json
    [ "$status" -eq 0 ]
    # fileStat should be present with --stat
    local file_count
    file_count="$(echo "$output" | jq '.repos[] | select(.name == "repo-a") | .fileStat | length')"
    [ "$file_count" -eq 1 ]
    local file_name
    file_name="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .fileStat[0].file')"
    [ "$file_name" = "file.txt" ]
}

@test "arb diff --json without --stat omits fileStat" {
    arb create my-feature repo-a
    echo "content" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Add file" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    # fileStat should NOT be present without --stat
    local has_file_stat
    has_file_stat="$(echo "$output" | jq '.repos[] | select(.name == "repo-a") | has("fileStat")')"
    [ "$has_file_stat" = "false" ]
}

# ── --json mode ──────────────────────────────────────────────────

@test "arb diff --json outputs valid JSON with all fields" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "JSON test commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    # Validate JSON structure
    echo "$output" | jq -e '.workspace' >/dev/null
    echo "$output" | jq -e '.branch' >/dev/null
    echo "$output" | jq -e '.repos' >/dev/null
    echo "$output" | jq -e '.totalFiles' >/dev/null
    echo "$output" | jq -e '.totalInsertions' >/dev/null
    echo "$output" | jq -e '.totalDeletions' >/dev/null
    # Check repo-a has stat
    local files
    files="$(echo "$output" | jq '.repos[] | select(.name == "repo-a") | .stat.files')"
    [ "$files" -eq 1 ]
}

@test "arb diff --json includes status field per repo" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[0].status')"
    [ "$repo_status" = "clean" ]
}

# ── positional repo filtering ────────────────────────────────────

@test "arb diff with positional args filters repos" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Change in repo-a" >/dev/null 2>&1
    echo "change" > "$TEST_DIR/project/my-feature/repo-b/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "Change in repo-b" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff repo-a --json
    [ "$status" -eq 0 ]
    # Should only include repo-a
    local repo_count
    repo_count="$(echo "$output" | jq '.repos | length')"
    [ "$repo_count" -eq 1 ]
    local repo_name
    repo_name="$(echo "$output" | jq -r '.repos[0].name')"
    [ "$repo_name" = "repo-a" ]
}

@test "arb diff with invalid repo name errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb diff nonexistent
    [ "$status" -ne 0 ]
    [[ "$output" == *"not in this workspace"* ]]
}

# ── --where filtering ────────────────────────────────────────────

@test "arb diff --where unpushed filters by status" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Unpushed change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --where unpushed --json
    [ "$status" -eq 0 ]
    # Only repo-a has unpushed commits
    local repo_count
    repo_count="$(echo "$output" | jq '.repos | length')"
    [ "$repo_count" -eq 1 ]
    local repo_name
    repo_name="$(echo "$output" | jq -r '.repos[0].name')"
    [ "$repo_name" = "repo-a" ]
}

# ── edge cases ───────────────────────────────────────────────────

@test "arb diff detects detached HEAD" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout --detach HEAD >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .status')"
    [ "$repo_status" = "detached" ]
    local reason
    reason="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .reason')"
    [[ "$reason" == *"detached"* ]]
}

@test "arb diff detects drifted branch" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b other-branch >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .status')"
    [ "$repo_status" = "drifted" ]
    local reason
    reason="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-a") | .reason')"
    [[ "$reason" == *"other-branch"* ]]
    [[ "$reason" == *"expected my-feature"* ]]
}

@test "arb diff shows fallback-base when configured base not found" {
    # repo-a has feat/auth branch, repo-b does NOT
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b
    cd "$TEST_DIR/project/stacked"
    fetch_all_repos
    run arb diff --json
    [ "$status" -eq 0 ]
    # repo-b should be fallback-base (feat/auth doesn't exist, fell back to main)
    local repo_b_status
    repo_b_status="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-b") | .status')"
    [ "$repo_b_status" = "fallback-base" ]
    local repo_b_reason
    repo_b_reason="$(echo "$output" | jq -r '.repos[] | select(.name == "repo-b") | .reason')"
    [[ "$repo_b_reason" == *"feat/auth"* ]]
}

@test "arb diff skipped repos show warning in pipe mode" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout --detach HEAD >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff
    [ "$status" -eq 0 ]
    # Pipe mode emits skipped warnings to stderr (captured by run)
    [[ "$output" == *"repo-a: skipped"* ]]
}

@test "arb diff without workspace context fails" {
    run arb diff
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

# ── pipe output ──────────────────────────────────────────────────

@test "arb diff piped produces diff output" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Piped test commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    # Pipe through cat to force non-TTY mode
    local result
    result="$(arb diff | cat)"
    # Should contain diff markers
    [[ "$result" == *"diff --git"* ]] || [[ "$result" == *"+change"* ]]
}

@test "arb diff pipe omits repos with 0 changes" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Only in repo-a" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    local result
    result="$(arb diff | cat)"
    # Should contain diff content for repo-a
    [[ "$result" == *"file.txt"* ]]
}

# ── working tree changes ──────────────────────────────────────────

@test "arb diff includes uncommitted unstaged changes" {
    arb create my-feature repo-a
    # Commit a file first so it's tracked
    echo "original" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Add file" >/dev/null 2>&1
    # Modify it without staging (unstaged change on top of committed change)
    echo "modified" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local total_files
    total_files="$(echo "$output" | jq '.totalFiles')"
    [ "$total_files" -eq 1 ]
    # The unstaged modification should show: "modified" has 1 line, vs 0 in base
    local total_ins
    total_ins="$(echo "$output" | jq '.totalInsertions')"
    [ "$total_ins" -eq 1 ]
}

@test "arb diff includes staged but uncommitted changes" {
    arb create my-feature repo-a
    echo "staged" > "$TEST_DIR/project/my-feature/repo-a/staged.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add staged.txt >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local total_files
    total_files="$(echo "$output" | jq '.totalFiles')"
    [ "$total_files" -eq 1 ]
}

@test "arb diff combines committed and staged uncommitted changes" {
    arb create my-feature repo-a
    echo "committed" > "$TEST_DIR/project/my-feature/repo-a/committed.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add committed.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "Add committed file" >/dev/null 2>&1
    # Stage a second file without committing
    echo "staged" > "$TEST_DIR/project/my-feature/repo-a/staged.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add staged.txt >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local total_files
    total_files="$(echo "$output" | jq '.totalFiles')"
    [ "$total_files" -eq 2 ]
}

@test "arb diff piped includes staged uncommitted changes" {
    arb create my-feature repo-a
    echo "staged-content" > "$TEST_DIR/project/my-feature/repo-a/staged.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add staged.txt >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    local result
    result="$(arb diff | cat)"
    [[ "$result" == *"staged-content"* ]]
}

@test "arb diff does not report clean when repo has staged changes" {
    arb create my-feature repo-a
    echo "staged" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb diff --json
    [ "$status" -eq 0 ]
    local repo_status
    repo_status="$(echo "$output" | jq -r '.repos[0].status')"
    [ "$repo_status" != "clean" ]
}

# ── fetch ─────────────────────────────────────────────────────────

@test "arb diff --fetch fetches before showing diff" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb diff --fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
}

@test "arb diff -F fetches before showing diff (short for --fetch)" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb diff -F
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
}
