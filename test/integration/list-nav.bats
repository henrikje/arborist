#!/usr/bin/env bats

load test_helper/common-setup

# ── list ─────────────────────────────────────────────────────────

@test "arb list shows workspaces" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    run arb list
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
}

@test "arb list highlights active workspace" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    cd "$TEST_DIR/project/ws-one"
    run arb list
    # ws-one should be marked with *
    [[ "$output" == *"* ws-one"* ]] || [[ "$output" == *"*ws-one"* ]]
}

@test "arb list ignores dirs without .arbws" {
    mkdir -p "$TEST_DIR/project/not-a-workspace"
    arb create real-ws --all-repos
    run arb list
    [[ "$output" == *"real-ws"* ]]
    [[ "$output" != *"not-a-workspace"* ]]
}

@test "arb list piped to cat has no escape sequences" {
    arb create ws-one repo-a
    run bash -c 'arb list | cat'
    # Output should not contain ESC characters
    [[ "$output" != *$'\033'* ]]
}

@test "arb list with no workspaces shows hint" {
    run arb list
    [ "$status" -eq 0 ]
    [[ "$output" == *"arb create"* ]]
}

@test "arb list shows repo count" {
    arb create ws-one repo-a repo-b
    run arb list
    [[ "$output" == *"2"* ]]
}

@test "arb list shows no issues status for fresh branch with no commits" {
    arb create ws-one repo-a
    run arb list
    [[ "$output" == *"no issues"* ]]
}

@test "arb list shows no issues status when pushed" {
    arb create ws-one repo-a
    echo "change" > "$TEST_DIR/project/ws-one/repo-a/f.txt"
    git -C "$TEST_DIR/project/ws-one/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-one/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-one/repo-a" push -u origin ws-one >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && git fetch origin) >/dev/null 2>&1
    run arb list
    [[ "$output" == *"no issues"* ]]
}

@test "arb list shows per-flag status labels" {
    arb create ws-one repo-a
    echo "change" > "$TEST_DIR/project/ws-one/repo-a/f.txt"
    git -C "$TEST_DIR/project/ws-one/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-one/repo-a" commit -m "commit" >/dev/null 2>&1
    echo "dirty" > "$TEST_DIR/project/ws-one/repo-a/dirty.txt"
    run arb list
    [[ "$output" == *"dirty"* ]]
    [[ "$output" == *"unpushed"* ]]
    [[ "$output" != *"with issues"* ]]
}

@test "arb list shows UPPERCASE headers" {
    arb create ws-one repo-a
    run arb list
    [[ "$output" == *"WORKSPACE"* ]]
    [[ "$output" == *"BRANCH"* ]]
    [[ "$output" == *"REPOS"* ]]
    [[ "$output" == *"LAST COMMIT"* ]]
    [[ "$output" == *"STATUS"* ]]
}

@test "arb list --no-status hides LAST COMMIT column" {
    arb create ws-one repo-a
    run arb list --no-status
    [[ "$output" != *"LAST COMMIT"* ]]
}

@test "arb list shows relative time in LAST COMMIT column" {
    arb create ws-one repo-a
    # Commit with a date 3 days ago
    (cd "$TEST_DIR/project/ws-one/repo-a" && \
     GIT_AUTHOR_DATE="$(date -v-3d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '3 days ago' +%Y-%m-%dT%H:%M:%S)" \
     git commit --allow-empty -m "old commit") >/dev/null 2>&1
    run arb list
    [[ "$output" == *"3 days"* ]]
}

@test "arb list shows months for old commits" {
    arb create ws-one repo-a
    (cd "$TEST_DIR/project/ws-one/repo-a" && \
     GIT_AUTHOR_DATE="$(date -v-90d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '90 days ago' +%Y-%m-%dT%H:%M:%S)" \
     git commit --allow-empty -m "old commit") >/dev/null 2>&1
    run arb list
    [[ "$output" == *"3 months"* ]]
}

@test "arb list LAST COMMIT column appears between REPOS and STATUS" {
    arb create ws-one repo-a
    run arb list
    # LAST COMMIT should appear between REPOS and STATUS in the header
    header=$(echo "$output" | head -1)
    repos_pos=$(echo "$header" | grep -bo "REPOS" | head -1 | cut -d: -f1)
    commit_pos=$(echo "$header" | grep -bo "LAST COMMIT" | head -1 | cut -d: -f1)
    status_pos=$(echo "$header" | grep -bo "STATUS" | head -1 | cut -d: -f1)
    # LAST COMMIT should be after REPOS and before STATUS
    [ "$commit_pos" -gt "$repos_pos" ]
    [ "$commit_pos" -lt "$status_pos" ]
}

@test "arb list shows branch name" {
    arb create ws-one --branch feat/payments repo-a
    run arb list
    [[ "$output" == *"feat/payments"* ]]
}

@test "arb list shows BASE column for stacked workspaces" {
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a
    arb create normal repo-b
    run arb list
    [[ "$output" == *"BASE"* ]]
    [[ "$output" == *"feat/auth"* ]]
}

@test "arb list hides BASE column when no stacked workspaces" {
    arb create ws-one repo-a
    run arb list
    [[ "$output" != *"BASE"* ]]
}

@test "arb list --no-status shows workspaces without STATUS column" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    run arb list --no-status
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    [[ "$output" == *"WORKSPACE"* ]]
    [[ "$output" == *"BRANCH"* ]]
    [[ "$output" == *"REPOS"* ]]
    [[ "$output" != *"STATUS"* ]]
    [[ "$output" != *"no issues"* ]]
}

@test "arb list -q outputs one workspace name per line" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    run arb list -q
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    # No headers, no ANSI
    [[ "$output" != *"WORKSPACE"* ]]
    [[ "$output" != *"STATUS"* ]]
    [[ "$output" != *$'\033'* ]]
}

@test "arb list piped output has no progress escape sequences" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    result=$(arb list 2>/dev/null)
    # stdout should not contain cursor movement sequences
    [[ "$result" != *$'\033['*'A'* ]]
}

@test "arb list --fetch fetches before listing" {
    arb create ws-one repo-a
    cd "$TEST_DIR/project/ws-one"
    run arb list --fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
    [[ "$output" == *"ws-one"* ]]
}

@test "arb list -F fetches before listing (short for --fetch)" {
    arb create ws-one repo-a
    cd "$TEST_DIR/project/ws-one"
    run arb list -F
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]
    [[ "$output" == *"ws-one"* ]]
}

@test "arb list -F shows status after fetch" {
    arb create ws-one repo-a
    run arb list -F
    [ "$status" -eq 0 ]
    [[ "$output" == *"no issues"* ]]
}

@test "arb list -F with dirty repo shows dirty status" {
    arb create ws-one repo-a
    echo "dirty" > "$TEST_DIR/project/ws-one/repo-a/dirty.txt"
    run arb list -F
    [ "$status" -eq 0 ]
    [[ "$output" == *"dirty"* ]]
}

@test "arb list -F --json outputs valid JSON with status" {
    arb create ws-one repo-a
    run bash -c 'arb list -F --json 2>/dev/null'
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ws = data[0]
assert ws['workspace'] == 'ws-one'
assert 'statusLabels' in ws
"
}

@test "arb list -F --quiet outputs workspace names" {
    arb create ws-one repo-a
    run arb list -F --quiet
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" != *"WORKSPACE"* ]]
}

@test "arb list --json outputs valid JSON" {
    arb create my-feature repo-a
    run arb list --json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "import sys, json; json.load(sys.stdin)"
}

@test "arb list --json includes workspace fields" {
    arb create my-feature repo-a repo-b
    run arb list --json
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ws = data[0]
assert ws['workspace'] == 'my-feature'
assert ws['branch'] == 'my-feature'
assert ws['repoCount'] == 2
assert ws['status'] is None
assert 'atRiskCount' in ws
assert 'statusLabels' in ws
assert 'lastCommit' in ws
assert isinstance(ws['lastCommit'], str), 'lastCommit should be an ISO date string'
"
}

@test "arb list --json marks active workspace" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    cd "$TEST_DIR/project/ws-one"
    run arb list --json
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
by_name = {ws['workspace']: ws for ws in data}
assert by_name['ws-one']['active'] is True
assert by_name['ws-two']['active'] is False
"
}

@test "arb list --json handles config-missing workspace" {
    arb create my-feature repo-a
    delete_workspace_config my-feature
    run arb list --json
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ws = data[0]
assert ws['status'] == 'config-missing'
assert ws['branch'] is None
assert ws['base'] is None
assert ws['repoCount'] is None
"
}

@test "arb list --json handles empty workspace" {
    mkdir -p "$TEST_DIR/project/empty-ws/.arbws"
    echo "branch = empty-ws" > "$TEST_DIR/project/empty-ws/.arbws/config"
    run arb list --json
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ws = [w for w in data if w['workspace'] == 'empty-ws'][0]
assert ws['status'] == 'empty'
assert ws['repoCount'] == 0
assert ws['branch'] == 'empty-ws'
"
}

@test "arb list --json --no-status omits aggregate fields" {
    arb create my-feature repo-a
    run arb list --json --no-status
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ws = data[0]
assert ws['workspace'] == 'my-feature'
assert ws['branch'] == 'my-feature'
assert ws['repoCount'] == 1
assert 'atRiskCount' not in ws
assert 'statusLabels' not in ws
"
}

@test "arb list --json --no-status includes basic metadata" {
    arb create my-feature repo-a
    run arb list --json --no-status
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ws = data[0]
assert 'workspace' in ws
assert 'active' in ws
assert 'branch' in ws
assert 'base' in ws
assert 'repoCount' in ws
assert 'status' in ws
"
}

@test "arb list --json contains no ANSI escape codes" {
    arb create ws-one repo-a
    result=$(arb list --json 2>/dev/null)
    [[ "$result" != *$'\033'* ]]
}

@test "arb list --json with no workspaces outputs empty array" {
    run arb list --json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assert data == []
"
}

# ── path ─────────────────────────────────────────────────────────

@test "arb path returns correct path" {
    arb create my-feature --all-repos
    run arb path my-feature
    [ "$output" = "$TEST_DIR/project/my-feature" ]
}

@test "arb path with no argument returns arb root from workspace" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature/repo-a"
    run arb path
    [ "$output" = "$TEST_DIR/project" ]
}

@test "arb path with subpath returns repo path" {
    arb create my-feature repo-a
    run arb path my-feature/repo-a
    [ "$output" = "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb path with no argument outside workspace returns arb root" {
    run arb path
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project" ]
}

@test "arb path with invalid subpath fails" {
    arb create my-feature repo-a
    run arb path my-feature/nonexistent
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found in workspace"* ]]
}

@test "arb path with nonexistent workspace fails" {
    run arb path does-not-exist
    [ "$status" -ne 0 ]
    [[ "$output" == *"does not exist"* ]]
}

# ── cd ───────────────────────────────────────────────────────────

@test "arb cd prints correct workspace path" {
    arb create my-feature --all-repos
    run arb cd my-feature
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/my-feature" ]
}

@test "arb cd with subpath prints correct repo path" {
    arb create my-feature repo-a
    run arb cd my-feature/repo-a
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb cd with nonexistent workspace fails" {
    run arb cd does-not-exist
    [ "$status" -ne 0 ]
    [[ "$output" == *"does not exist"* ]]
}

@test "arb cd with nonexistent subpath fails" {
    arb create my-feature repo-a
    run arb cd my-feature/nonexistent
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found in workspace"* ]]
}

@test "arb cd with no arg in non-TTY fails" {
    run arb cd
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage: arb cd"* ]]
}

@test "arb cd rejects non-workspace directory" {
    mkdir -p "$TEST_DIR/project/not-a-workspace"
    run arb cd not-a-workspace
    [ "$status" -ne 0 ]
    [[ "$output" == *"does not exist"* ]]
}

@test "arb cd path output is clean when stdout is captured (shell wrapper pattern)" {
    arb create my-feature --all-repos
    # Simulate the shell wrapper: capture stdout via $(), which makes stdout a pipe.
    # Verify only the workspace path appears on stdout (no UI, no hint).
    _arb_dir="$(arb cd my-feature 2>/dev/null)"
    [ "$_arb_dir" = "$TEST_DIR/project/my-feature" ]
}

@test "arb cd subpath output is clean when stdout is captured" {
    arb create my-feature repo-a
    _arb_dir="$(arb cd my-feature/repo-a 2>/dev/null)"
    [ "$_arb_dir" = "$TEST_DIR/project/my-feature/repo-a" ]
}

# ── cd scope-aware ───────────────────────────────────────────────

@test "arb cd resolves repo name when inside a workspace" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb cd repo-a
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb cd resolves repo from a nested repo directory" {
    arb create my-feature repo-a repo-b
    mkdir -p "$TEST_DIR/project/my-feature/repo-a/src"
    cd "$TEST_DIR/project/my-feature/repo-a/src"
    run arb cd repo-b
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/my-feature/repo-b" ]
}

@test "arb cd falls back to workspace when name is not a repo" {
    arb create ws-alpha repo-a
    arb create ws-beta repo-b
    cd "$TEST_DIR/project/ws-alpha"
    run arb cd ws-beta
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/ws-beta" ]
}

@test "arb cd prefers repo over workspace when ambiguous" {
    # Create a workspace named "repo-a" AND a repo named "repo-a" in another workspace
    arb create repo-a repo-b
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb cd repo-a
    [ "$status" -eq 0 ]
    # Should resolve to the repo, not the workspace
    [ "$output" = "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb cd explicit ws/repo syntax still works from inside a workspace" {
    arb create ws-alpha repo-a
    arb create ws-beta repo-b
    cd "$TEST_DIR/project/ws-alpha"
    run arb cd ws-beta/repo-b
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/ws-beta/repo-b" ]
}

@test "arb cd error when name matches neither repo nor workspace" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb cd nonexistent
    [ "$status" -ne 0 ]
    [[ "$output" == *"is not a repo in workspace"* ]]
    [[ "$output" == *"or a workspace"* ]]
}

@test "arb cd behavior unchanged when at arb root" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project"
    run arb cd my-feature
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/my-feature" ]
}

# ── path scope-aware ─────────────────────────────────────────────

@test "arb path resolves repo name when inside a workspace" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb path repo-a
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb path falls back to workspace when not a repo" {
    arb create ws-alpha repo-a
    arb create ws-beta repo-b
    cd "$TEST_DIR/project/ws-alpha"
    run arb path ws-beta
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/ws-beta" ]
}

@test "arb path prefers repo over workspace when ambiguous" {
    arb create repo-a repo-b
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb path repo-a
    [ "$status" -eq 0 ]
    [ "$output" = "$TEST_DIR/project/my-feature/repo-a" ]
}

# ── -C / --chdir ─────────────────────────────────────────────────

@test "arb -C targets the given directory" {
    cd /tmp
    run arb -C "$TEST_DIR/project" repo list
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb -C resolves relative paths" {
    cd "$TEST_DIR"
    run arb -C project repo list
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
}

@test "arb -C with non-existent directory fails" {
    run arb -C /no/such/directory repo list
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot change to"* ]]
    [[ "$output" == *"no such directory"* ]]
}

@test "arb -C with init creates arb root in target directory" {
    mkdir "$TEST_DIR/new-root"
    cd /tmp
    run arb -C "$TEST_DIR/new-root" init
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/new-root/.arb" ]
}

@test "arb -C with status detects workspace from target directory" {
    arb create my-feature repo-a
    cd /tmp
    run arb -C "$TEST_DIR/project/my-feature" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
}

@test "arb -C with list shows workspaces" {
    arb create my-feature repo-a
    cd /tmp
    run arb -C "$TEST_DIR/project" list --no-status
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-feature"* ]]
}

@test "arb -C with path prints correct path" {
    arb create my-feature repo-a
    cd /tmp
    run arb -C "$TEST_DIR/project" path
    [ "$status" -eq 0 ]
    [[ "$output" == *"$TEST_DIR/project"* ]]
}

@test "arb -C with cd outputs correct directory" {
    arb create my-feature repo-a
    cd /tmp
    run arb -C "$TEST_DIR/project" cd my-feature
    [ "$status" -eq 0 ]
    [[ "$output" == *"$TEST_DIR/project/my-feature"* ]]
}

@test "arb list --dirty filters to dirty workspaces" {
    arb create ws-clean repo-a
    arb create ws-dirty repo-a
    echo "uncommitted" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"
    run arb list --dirty
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-dirty"* ]]
    [[ "$output" != *"ws-clean"* ]]
}

@test "arb list -d filters to dirty workspaces" {
    arb create ws-clean repo-a
    arb create ws-dirty repo-a
    echo "uncommitted" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"
    run arb list -d
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-dirty"* ]]
    [[ "$output" != *"ws-clean"* ]]
}

@test "arb list --dirty --where conflicts" {
    arb create ws-one repo-a
    run arb list --dirty --where unpushed
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --dirty with --where"* ]]
}

@test "arb list --dirty --no-status conflicts" {
    arb create ws-one repo-a
    run arb list --dirty --no-status
    [ "$status" -ne 0 ]
    [[ "$output" == *"--where"* ]]
}

@test "arb list --quiet outputs workspace names only" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    run arb list --quiet
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    [[ "$output" != *"WORKSPACE"* ]]
    [[ "$output" != *"BRANCH"* ]]
}

@test "arb list --quiet --where filters workspace names" {
    arb create ws-clean repo-a
    arb create ws-dirty repo-a
    echo "uncommitted" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"
    run arb list --quiet --where dirty
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-dirty"* ]]
    [[ "$output" != *"ws-clean"* ]]
}

@test "arb list -q includes config-missing workspaces" {
    arb create ws-one repo-a
    delete_workspace_config ws-one
    run arb list -q
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
}

@test "arb list -q includes empty workspaces" {
    mkdir -p "$TEST_DIR/project/empty-ws/.arbws"
    echo "branch = empty-ws" > "$TEST_DIR/project/empty-ws/.arbws/config"
    run arb list -q
    [ "$status" -eq 0 ]
    [[ "$output" == *"empty-ws"* ]]
}

@test "arb list --quiet --json conflicts" {
    arb create ws-one repo-a
    run arb list --quiet --json
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --quiet with --json"* ]]
}

@test "arb repo list --quiet outputs repo names only" {
    run arb repo list -q
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" != *"REPO"* ]]
    [[ "$output" != *"URL"* ]]
}

@test "arb repo list --json outputs valid JSON with share and base" {
    run arb repo list --json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assert len(data) == 2
assert 'name' in data[0]
assert 'url' in data[0]
assert 'share' in data[0]
assert 'base' in data[0]
assert 'name' in data[0]['share']
assert 'url' in data[0]['share']
assert 'name' in data[0]['base']
assert 'url' in data[0]['base']
"
}

@test "arb repo list --quiet --json conflicts" {
    run arb repo list --quiet --json
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --quiet with --json"* ]]
}

@test "arb repo list --verbose --quiet conflicts" {
    run arb repo list --verbose --quiet
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --quiet with --verbose"* ]]
}

@test "arb repo list --verbose --json conflicts" {
    run arb repo list --verbose --json
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --verbose with --json"* ]]
}

@test "arb list suppresses diverged and behind-base for squash-merged workspace" {
    arb create merged-ws repo-a
    local wt="$TEST_DIR/project/merged-ws/repo-a"

    # Make feature work and push
    echo "feature content" > "$wt/feature.txt"
    git -C "$wt" add feature.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/merged-ws"
    arb push --yes >/dev/null 2>&1

    # Squash merge + delete remote branch
    local bare="$TEST_DIR/origin/repo-a.git"
    local tmp="$TEST_DIR/tmp-squash-list"
    git clone "$bare" "$tmp" >/dev/null 2>&1
    (cd "$tmp" && git merge --squash origin/merged-ws && git commit -m "squash merge") >/dev/null 2>&1
    (cd "$tmp" && git push origin main) >/dev/null 2>&1
    rm -rf "$tmp"
    git -C "$bare" branch -D merged-ws >/dev/null 2>&1
    fetch_all_repos

    run arb list
    [[ "$output" == *"merged"* ]]
    [[ "$output" == *"gone"* ]]
    [[ "$output" != *"diverged"* ]]
    [[ "$output" != *"behind base"* ]]
}

@test "arb -C is visible in --help output" {
    run arb --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"-C <directory>"* ]]
}

