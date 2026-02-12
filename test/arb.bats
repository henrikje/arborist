#!/usr/bin/env bats

setup() {
    TEST_DIR="$(mktemp -d)"
    TEST_DIR="$(cd "$TEST_DIR" && pwd -P)"
    export PATH="$BATS_TEST_DIRNAME/../dist:$PATH"

    # Initialize arb root first
    mkdir -p "$TEST_DIR/project"
    cd "$TEST_DIR/project"
    arb init >/dev/null 2>&1

    # Create bare origin repos and clone into .arb/repos/
    git init --bare "$TEST_DIR/origin/repo-a.git" >/dev/null 2>&1
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/project/.arb/repos/repo-a" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1

    git init --bare "$TEST_DIR/origin/repo-b.git" >/dev/null 2>&1
    git clone "$TEST_DIR/origin/repo-b.git" "$TEST_DIR/project/.arb/repos/repo-b" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-b" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
}

teardown() {
    rm -rf "$TEST_DIR"
}

# ── version & help ───────────────────────────────────────────────

@test "arb --version outputs version number" {
    run arb --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^Arborist\ [0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "arb version is treated as unknown command" {
    run arb version
    [ "$status" -ne 0 ]
}

@test "arb -v outputs version number" {
    run arb -v
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^Arborist\ [0-9]+\.[0-9]+\.[0-9]+$ ]]
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
    arb init
    [ -d "$dir/.arb" ]
    [ -d "$dir/.arb/repos" ]
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
    git init --bare "$TEST_DIR/origin/derived-name.git" >/dev/null 2>&1
    run arb clone "$TEST_DIR/origin/derived-name.git"
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/derived-name/.git" ]
}

@test "arb clone fails if repo already exists" {
    run arb clone "$TEST_DIR/origin/repo-a.git" repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"already exists"* ]]
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

# ── create ───────────────────────────────────────────────────────

@test "arb create creates workspace with .arbws/config" {
    arb create my-feature --all-repos
    [ -d "$TEST_DIR/project/my-feature" ]
    [ -d "$TEST_DIR/project/my-feature/.arbws" ]
    [ -f "$TEST_DIR/project/my-feature/.arbws/config" ]
}

@test ".arbws/config contains correct branch" {
    arb create my-feature --all-repos
    run cat "$TEST_DIR/project/my-feature/.arbws/config"
    [[ "$output" == *"branch = my-feature"* ]]
}

@test "arb create with repos creates worktrees" {
    arb create my-feature repo-a repo-b
    [ -d "$TEST_DIR/project/my-feature/repo-a" ]
    [ -d "$TEST_DIR/project/my-feature/repo-b" ]
}

@test "arb create --all-repos creates worktrees for all repos" {
    arb create all-ws --all-repos
    [ -d "$TEST_DIR/project/all-ws/repo-a" ]
    [ -d "$TEST_DIR/project/all-ws/repo-b" ]
}

@test "arb create -a creates worktrees for all repos" {
    arb create all-ws -a
    [ -d "$TEST_DIR/project/all-ws/repo-a" ]
    [ -d "$TEST_DIR/project/all-ws/repo-b" ]
}

@test "arb create --branch stores custom branch in config" {
    arb create payments --branch feat/payments repo-a
    run cat "$TEST_DIR/project/payments/.arbws/config"
    [[ "$output" == *"branch = feat/payments"* ]]
}

@test "arb create -b stores custom branch in config" {
    arb create payments -b feat/payments repo-a
    run cat "$TEST_DIR/project/payments/.arbws/config"
    [[ "$output" == *"branch = feat/payments"* ]]
}

@test "arb create derives branch from workspace name (lowercased)" {
    arb create MyFeature --all-repos
    run cat "$TEST_DIR/project/MyFeature/.arbws/config"
    [[ "$output" == *"branch = myfeature"* ]]
}

@test "arb create attaches existing branch" {
    # Create a branch with unique content directly in the canonical repo
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b reuse-me >/dev/null 2>&1
    echo "branch-content" > "$TEST_DIR/project/.arb/repos/repo-a/marker.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add marker.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "marker" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout main >/dev/null 2>&1

    # Create a workspace that reuses the existing branch
    arb create reuse-ws --branch reuse-me repo-a
    # The worktree should be on the existing branch with the prior commit
    [ -f "$TEST_DIR/project/reuse-ws/repo-a/marker.txt" ]
    # Verify it's on the correct branch
    local branch
    branch="$(git -C "$TEST_DIR/project/reuse-ws/repo-a" branch --show-current)"
    [ "$branch" = "reuse-me" ]
}

@test "arb create produces no stdout" {
    run bash -c 'arb create foo repo-a 2>/dev/null'
    [ -z "$output" ]
}

@test "arb create with duplicate workspace name fails" {
    arb create my-feature repo-a
    run arb create my-feature repo-b
    [ "$status" -ne 0 ]
    [[ "$output" == *"already exists"* ]]
}

@test "arb create with no repos and no --all-repos fails" {
    run arb create no-repos-ws
    [ "$status" -ne 0 ]
    [[ "$output" == *"No repos specified"* ]]
    [[ "$output" == *"--all-repos"* ]]
    [ ! -d "$TEST_DIR/project/no-repos-ws" ]
}

@test "arb create without name fails" {
    run arb create
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage: arb create"* ]]
}

@test "arb create --branch without value fails" {
    run arb create foo --branch
    [ "$status" -ne 0 ]
    [[ "$output" == *"argument missing"* ]]
}

@test "arb create with invalid branch name fails" {
    run arb create bad-ws --branch "bad branch name with spaces" repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid branch name"* ]]
}

@test "arb create rejects name with slash" {
    run arb create "bad/name"
    [ "$status" -ne 0 ]
    [[ "$output" == *"must not contain '/'"* ]]
}

@test "arb create rejects name with path traversal" {
    run arb create "foo..bar"
    [ "$status" -ne 0 ]
    [[ "$output" == *"must not contain '..'"* ]]
}

@test "arb create rejects name with whitespace" {
    run arb create "bad name"
    [ "$status" -ne 0 ]
    [[ "$output" == *"must not contain whitespace"* ]]
}

# ── add ──────────────────────────────────────────────────────────

@test "arb add reads branch from config" {
    arb create my-feature --branch feat/custom repo-b
    cd "$TEST_DIR/project/my-feature"
    arb add repo-a
    [ -d "$TEST_DIR/project/my-feature/repo-a" ]
    # Verify the worktree is on the correct branch
    local branch
    branch="$(git -C "$TEST_DIR/project/my-feature/repo-a" branch --show-current)"
    [ "$branch" = "feat/custom" ]
}

@test "arb add skips repo already in workspace" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb add repo-a
    [[ "$output" == *"already exists"* ]] || [[ "$output" == *"Skipping"* ]] || [[ "$output" == *"skipping"* ]] || [[ "$output" == *"Skipped"* ]]
}

@test "arb add with nonexistent repo fails" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb add no-such-repo
    [[ "$output" == *"not a git repo"* ]] || [[ "$output" == *"failed"* ]]
}

@test "arb add without workspace context fails" {
    run arb add repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

@test "arb add without args fails" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb add
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage: arb add"* ]]
}

@test "arb add recovers from stale worktree reference" {
    arb create my-feature repo-a repo-b
    # Remove workspace dir without git worktree remove (leaves stale reference)
    rm -rf "$TEST_DIR/project/my-feature"
    # Re-create workspace and re-add — should succeed thanks to proactive prune
    mkdir -p "$TEST_DIR/project/my-feature/.arbws"
    echo "branch = my-feature" > "$TEST_DIR/project/my-feature/.arbws/config"
    cd "$TEST_DIR/project/my-feature"
    run arb add repo-a repo-b
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/my-feature/repo-a" ]
    [ -d "$TEST_DIR/project/my-feature/repo-b" ]
}

# ── drop ─────────────────────────────────────────────────────────

@test "arb drop removes a repo from workspace" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    arb drop repo-b
    [ ! -d "$TEST_DIR/project/my-feature/repo-b" ]
    [ -d "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb drop skips repo with uncommitted changes without --force" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb drop repo-a
    [[ "$output" == *"uncommitted changes"* ]]
    [ -d "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb drop --force removes repo even with uncommitted changes" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    arb drop --force repo-a
    [ ! -d "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb drop -f removes repo even with uncommitted changes" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    arb drop -f repo-a
    [ ! -d "$TEST_DIR/project/my-feature/repo-a" ]
}

@test "arb drop --delete-branch also deletes local branch" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    arb drop --delete-branch repo-b
    [ ! -d "$TEST_DIR/project/my-feature/repo-b" ]
    run git -C "$TEST_DIR/project/.arb/repos/repo-b" show-ref --verify "refs/heads/my-feature"
    [ "$status" -ne 0 ]
}

@test "arb drop skips repo not in workspace" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb drop repo-b
    [[ "$output" == *"not in this workspace"* ]]
}

@test "arb drop without args fails" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb drop
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage: arb drop"* ]]
}

@test "arb drop without workspace context fails" {
    run arb drop repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

# ── remove ───────────────────────────────────────────────────────

@test "arb remove --force removes worktrees, branches, workspace dir" {
    arb create my-feature repo-a repo-b
    arb remove my-feature --force
    [ ! -d "$TEST_DIR/project/my-feature" ]
    # Branch should be deleted from canonical repo
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/heads/my-feature"
    [ "$status" -ne 0 ]
}

@test "arb remove -f removes worktrees, branches, workspace dir" {
    arb create my-feature repo-a repo-b
    arb remove my-feature -f
    [ ! -d "$TEST_DIR/project/my-feature" ]
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/heads/my-feature"
    [ "$status" -ne 0 ]
}

@test "arb remove --force --delete-remote deletes remote branches" {
    arb create my-feature repo-a
    # Push the branch to the remote first
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    arb remove my-feature --force --delete-remote
    # Remote branch should be gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/my-feature"
    [ "$status" -ne 0 ]
}

@test "arb remove -f -d deletes remote branches" {
    arb create my-feature repo-a
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    arb remove my-feature -f -d
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/my-feature"
    [ "$status" -ne 0 ]
}

@test "arb remove aborts on non-interactive input" {
    arb create my-feature repo-a
    run bash -c 'echo "" | arb remove my-feature'
    [ "$status" -ne 0 ]
    [[ "$output" == *"not a terminal"* ]]
}

@test "arb remove nonexistent workspace fails" {
    run arb remove ghost --force
    [ "$status" -ne 0 ]
    [[ "$output" == *"No workspace found"* ]]
}

@test "arb remove without name fails" {
    run arb remove
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing required argument"* ]]
}

# ── list ─────────────────────────────────────────────────────────

@test "arb list shows workspaces and repos" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    run arb list
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
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

@test "arb list with no workspaces shows message" {
    run arb list
    [[ "$output" == *"No workspaces found"* ]]
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

# ── status ───────────────────────────────────────────────────────

@test "arb status uses dynamic default branch label" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"main:"* ]]
}

@test "arb status shows even when on same commit as default branch" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"even"* ]]
}

@test "arb status shows ahead count after local commit" {
    arb create my-feature repo-a
    echo "new" > "$TEST_DIR/project/my-feature/repo-a/new.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add new.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "ahead" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"1 ahead"* ]]
}

@test "arb status shows behind count when default branch is ahead" {
    arb create my-feature repo-a

    # Add a commit to origin's default branch
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status shows not pushed when branch not on remote" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"not pushed"* ]]
}

@test "arb status shows in sync after push with no new commits" {
    arb create my-feature repo-a

    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"in sync"* ]]
}

@test "arb status shows staged count" {
    arb create my-feature repo-a
    echo "staged" > "$TEST_DIR/project/my-feature/repo-a/staged.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add staged.txt >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"staged"* ]]
}

@test "arb status shows modified count" {
    arb create my-feature repo-a
    # Create a tracked file first
    echo "orig" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add tracked.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "add tracked" >/dev/null 2>&1
    # Now modify it
    echo "changed" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"modified"* ]]
}

@test "arb status shows untracked count" {
    arb create my-feature repo-a
    echo "untracked" > "$TEST_DIR/project/my-feature/repo-a/untracked.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"untracked"* ]]
}

@test "arb status shows no repos message for empty workspace" {
    mkdir -p "$TEST_DIR/project/empty-ws/.arbws"
    echo "branch = empty" > "$TEST_DIR/project/empty-ws/.arbws/config"
    cd "$TEST_DIR/project/empty-ws"
    run arb status
    [[ "$output" == *"(no repos)"* ]]
}

@test "arb status ignores non-git dirs in workspace" {
    arb create my-feature repo-a
    mkdir -p "$TEST_DIR/project/my-feature/stray-dir"
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"stray-dir"* ]]
}

@test "arb status without workspace context fails" {
    run arb status
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

@test "arb status --dirty shows only dirty repos" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status --dirty
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status -d shows only dirty repos" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status -d
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --dirty shows no repos when all clean" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status --dirty
    [ "$status" -eq 0 ]
    [[ "$output" == *"(no repos)"* ]]
}

@test "arb status shows drift warning when on wrong branch" {
    arb create my-feature repo-a repo-b
    # Manually switch repo-a to a different branch
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"on branch experiment, expected my-feature"* ]]
    # repo-b should NOT have the warning
    [[ "$output" != *"repo-b"*"expected"* ]]
}

@test "default branch detection with master" {
    git init --bare "$TEST_DIR/origin/repo-master.git" -b master >/dev/null 2>&1
    git clone "$TEST_DIR/origin/repo-master.git" "$TEST_DIR/project/.arb/repos/repo-master" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-master" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1

    arb create test-master repo-master
    cd "$TEST_DIR/project/test-master"
    run arb status
    [[ "$output" == *"master:"* ]]
}

# ── fetch ────────────────────────────────────────────────────────

@test "arb fetch succeeds" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"[repo-a] up to date"* ]]
    [[ "$output" == *"[repo-b] up to date"* ]]
}

@test "arb fetch without workspace context fails" {
    run arb fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

@test "arb fetch shows error output on failure" {
    arb create my-feature repo-a
    # Break the remote URL so fetch fails immediately with a git error
    git -C "$TEST_DIR/project/.arb/repos/repo-a" remote set-url origin "file:///nonexistent/repo.git"
    cd "$TEST_DIR/project/my-feature"
    run arb fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"fetch failed"* ]]
    # The actual git error should appear indented in the output
    [[ "$output" == *"fatal:"* ]] || [[ "$output" == *"does not appear to be a git repository"* ]]
}

@test "arb fetch times out with ARB_FETCH_TIMEOUT" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"

    # Shadow git with a script that hangs on fetch
    mkdir -p "$TEST_DIR/fake-bin"
    cat > "$TEST_DIR/fake-bin/git" <<'SCRIPT'
#!/usr/bin/env bash
if [[ "$1" == "-C" && "$3" == "fetch" ]]; then
    exec sleep 30
fi
exec /usr/bin/git "$@"
SCRIPT
    chmod +x "$TEST_DIR/fake-bin/git"

    run env PATH="$TEST_DIR/fake-bin:$PATH" ARB_FETCH_TIMEOUT=2 arb fetch
    [ "$status" -ne 0 ]
    [[ "$output" == *"timed out"* ]]
}

# ── pull ─────────────────────────────────────────────────────────

@test "arb pull after push succeeds" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
}

@test "arb pull uses parallel fetch then sequential pull" {
    arb create my-feature repo-a repo-b

    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb pull without push shows not pushed" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb pull
    [[ "$output" == *"not pushed yet"* ]]
}

@test "arb pull continues through repos on conflict" {
    arb create my-feature repo-a repo-b

    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"

    # Create a conflict in repo-a: modify same file in origin and worktree
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "origin change" > conflict.txt && git add conflict.txt && git commit -m "origin" && git push) >/dev/null 2>&1
    echo "local change" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1

    run arb pull
    # repo-b should still have been attempted
    [[ "$output" == *"repo-b"* ]]
}

@test "arb pull skips repo on wrong branch" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1
    # Manually switch repo-a to a different branch
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb pull
    [[ "$output" == *"[repo-a] on branch experiment, expected my-feature"* ]]
    [[ "$output" == *"skipping"* ]]
    # repo-b should still be pulled
    [[ "$output" == *"[repo-b] pulling my-feature"* ]]
}

@test "arb pull without workspace context fails" {
    run arb pull
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

# ── push ─────────────────────────────────────────────────────────

@test "arb push pushes feature branch to origin" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]
    # Verify the branch exists on the remote
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/my-feature"
    [ "$status" -eq 0 ]
}

@test "arb push skips local repos" {
    setup_local_repo
    arb create push-ws local-lib
    cd "$TEST_DIR/project/push-ws"
    run arb push
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" == *"skipping"* ]]
}

@test "arb push skips repo on wrong branch" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push
    [[ "$output" == *"[repo-a] on branch experiment, expected my-feature"* ]]
}

@test "arb push without workspace context fails" {
    run arb push
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not inside a workspace"* ]]
}

# ── exec ─────────────────────────────────────────────────────────

@test "arb exec runs in each repo, skips .arbws/" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb exec echo hello
    [[ "$output" == *"[repo-a]"* ]]
    [[ "$output" == *"[repo-b]"* ]]
    [[ "$output" == *"hello"* ]]
    [[ "$output" != *"[.arbws]"* ]]
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

@test "arb open --dirty shows nothing to open when all clean" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb open --dirty true
    [[ "$output" == *"nothing to open"* ]]
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

# ── --workspace flag ─────────────────────────────────────────────

@test "arb --workspace flag overrides cwd detection" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    cd "$TEST_DIR/project/ws-one"
    run arb --workspace ws-two status
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb -w flag overrides cwd detection" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    cd "$TEST_DIR/project/ws-one"
    run arb -w ws-two status
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-b"* ]]
}

@test "arb --workspace without value fails" {
    run arb --workspace
    [ "$status" -ne 0 ]
    [[ "$output" == *"argument missing"* ]]
}

# ── local repos (no remote) ──────────────────────────────────────

setup_local_repo() {
    git init "$TEST_DIR/project/.arb/repos/local-lib" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/local-lib" && git commit --allow-empty -m "init") >/dev/null 2>&1
}

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
    run arb pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" == *"skipping"* ]]
}

@test "arb remove cleans up local repo without attempting remote operations" {
    setup_local_repo
    arb create local-ws local-lib
    arb remove local-ws --force
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

    # status works for both
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"local-lib"* ]]

    # fetch skips local, fetches remote
    run arb fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" == *"repo-a"* ]]

    # pull skips local
    run arb pull
    [ "$status" -eq 0 ]
}

# ── missing config recovery ──────────────────────────────────────

# Helper: create a workspace then delete its config file
delete_workspace_config() {
    local name="$1"
    rm -f "$TEST_DIR/project/$name/.arbws/config"
}

@test "arb status works with missing config (infers branch)" {
    arb create my-feature repo-a
    delete_workspace_config my-feature
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    # Should warn about missing config
    [[ "$output" == *"Config missing"* ]] || [[ "$output" == *"inferred branch"* ]]
}

@test "arb add works when worktrees exist but config is missing" {
    arb create my-feature repo-a
    delete_workspace_config my-feature
    cd "$TEST_DIR/project/my-feature"
    run arb add repo-b
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/my-feature/repo-b" ]
    # Verify repo-b is on the inferred branch
    local branch
    branch="$(git -C "$TEST_DIR/project/my-feature/repo-b" branch --show-current)"
    [ "$branch" = "my-feature" ]
}

@test "arb add fails when config is missing and no worktrees exist" {
    mkdir -p "$TEST_DIR/project/empty-ws/.arbws"
    echo "branch = empty-ws" > "$TEST_DIR/project/empty-ws/.arbws/config"
    delete_workspace_config empty-ws
    cd "$TEST_DIR/project/empty-ws"
    run arb add repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"No branch configured"* ]] || [[ "$output" == *"no worktrees to infer"* ]]
}

@test "arb remove --force works with missing config" {
    arb create my-feature repo-a repo-b
    delete_workspace_config my-feature
    arb remove my-feature --force
    [ ! -d "$TEST_DIR/project/my-feature" ]
    # Branch should still be cleaned up
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/heads/my-feature"
    [ "$status" -ne 0 ]
}

@test "arb list shows config missing indicator" {
    arb create my-feature repo-a
    delete_workspace_config my-feature
    run arb list
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-feature"* ]]
    [[ "$output" == *"config missing"* ]]
}

@test "arb pull works with missing config (infers branch)" {
    arb create my-feature repo-a
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    delete_workspace_config my-feature
    cd "$TEST_DIR/project/my-feature"
    run arb pull
    [ "$status" -eq 0 ]
    [[ "$output" == *"inferred branch"* ]] || [[ "$output" == *"Config missing"* ]]
}

