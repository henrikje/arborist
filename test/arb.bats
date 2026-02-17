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
    git init --bare "$TEST_DIR/origin/repo-a.git" -b main >/dev/null 2>&1
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/project/.arb/repos/repo-a" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1

    git init --bare "$TEST_DIR/origin/repo-b.git" -b main >/dev/null 2>&1
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
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout - >/dev/null 2>&1

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

@test "arb create shows workspace path" {
    run arb create path-test repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"$TEST_DIR/project/path-test"* ]]
}

@test "arb create with duplicate workspace name fails" {
    arb create my-feature repo-a
    run arb create my-feature repo-b
    [ "$status" -ne 0 ]
    [[ "$output" == *"already exists"* ]]
}

@test "arb create with no repos creates empty workspace" {
    run arb create no-repos-ws
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/no-repos-ws/.arbws" ]
    [[ "$output" == *"No repos added"* ]]
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

@test "arb add without args fails in non-TTY" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb add
    [ "$status" -ne 0 ]
    [[ "$output" == *"No repos specified"* ]]
    [[ "$output" == *"--all-repos"* ]]
}

@test "arb add -a adds all remaining repos" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb add -a
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/my-feature/repo-b" ]
}

@test "arb add --all-repos adds all remaining repos" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb add --all-repos
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/my-feature/repo-b" ]
}

@test "arb add -a when all repos already present errors" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb add -a
    [ "$status" -ne 0 ]
    [[ "$output" == *"All repos are already in this workspace"* ]]
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

@test "arb drop without args fails in non-TTY" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb drop
    [ "$status" -ne 0 ]
    [[ "$output" == *"No repos specified"* ]]
    [[ "$output" == *"--all-repos"* ]]
}

@test "arb drop -a drops all repos from workspace" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb drop -a
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/my-feature/repo-a" ]
    [ ! -d "$TEST_DIR/project/my-feature/repo-b" ]
}

@test "arb drop --all-repos drops all repos from workspace" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb drop --all-repos
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/my-feature/repo-a" ]
    [ ! -d "$TEST_DIR/project/my-feature/repo-b" ]
}

@test "arb drop -a on empty workspace errors" {
    mkdir -p "$TEST_DIR/project/empty-ws/.arbws"
    echo "branch = empty" > "$TEST_DIR/project/empty-ws/.arbws/config"
    cd "$TEST_DIR/project/empty-ws"
    run arb drop -a
    [ "$status" -ne 0 ]
    [[ "$output" == *"No repos in this workspace"* ]]
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

@test "arb remove --force --delete-remote reports failed remote delete" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1

    # Make repo-b's remote unreachable so the push --delete fails
    mv "$TEST_DIR/origin/repo-b.git" "$TEST_DIR/origin/repo-b.git.bak"

    run arb remove my-feature --force --delete-remote
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/my-feature" ]
    [[ "$output" == *"failed to delete remote branch"* ]]

    # Restore for teardown
    mv "$TEST_DIR/origin/repo-b.git.bak" "$TEST_DIR/origin/repo-b.git"
}

@test "arb remove aborts on non-interactive input" {
    arb create my-feature repo-a
    run bash -c 'echo "" | arb remove my-feature'
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not a terminal"* ]]
    [[ "$output" == *"--yes"* ]]
}

@test "arb remove nonexistent workspace fails" {
    run arb remove ghost --force
    [ "$status" -ne 0 ]
    [[ "$output" == *"No workspace found"* ]]
}

@test "arb remove without args fails in non-TTY" {
    run arb remove
    [ "$status" -ne 0 ]
    [[ "$output" == *"No workspace specified"* ]]
}

@test "arb remove multiple workspaces with --force" {
    arb create ws-a repo-a
    arb create ws-b repo-b
    arb remove ws-a ws-b --force
    [ ! -d "$TEST_DIR/project/ws-a" ]
    [ ! -d "$TEST_DIR/project/ws-b" ]
}

@test "arb remove multiple workspaces removes all" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    run arb remove ws-one ws-two --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-one" ]
    [ ! -d "$TEST_DIR/project/ws-two" ]
}

@test "arb remove refuses workspace with merge conflict" {
    arb create my-feature repo-a
    local wt="$TEST_DIR/project/my-feature/repo-a"

    # Create a file on the feature branch
    echo "feature" > "$wt/conflict.txt"
    git -C "$wt" add conflict.txt
    git -C "$wt" commit -m "feature change" >/dev/null 2>&1

    # Create a conflicting change on the default branch via the canonical repo
    local canonical="$TEST_DIR/project/.arb/repos/repo-a"
    local default_branch
    default_branch="$(git -C "$canonical" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
    git -C "$canonical" checkout "$default_branch" >/dev/null 2>&1
    echo "main" > "$canonical/conflict.txt"
    git -C "$canonical" add conflict.txt
    git -C "$canonical" commit -m "main change" >/dev/null 2>&1
    git -C "$canonical" push >/dev/null 2>&1
    git -C "$canonical" checkout --detach HEAD >/dev/null 2>&1

    # Fetch and attempt merge to create conflict state
    git -C "$wt" fetch origin >/dev/null 2>&1
    git -C "$wt" merge "origin/$default_branch" >/dev/null 2>&1 || true

    # Status should show conflicts
    run arb -w my-feature status
    [[ "$output" == *"conflicts"* ]]

    # Remove without --force should refuse (non-TTY exits before at-risk check)
    run arb remove my-feature
    [ "$status" -ne 0 ]
    # Workspace should still exist
    [ -d "$TEST_DIR/project/my-feature" ]

    # Force remove should succeed
    arb remove my-feature --force
    [ ! -d "$TEST_DIR/project/my-feature" ]
}

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

@test "arb list shows UPPERCASE headers" {
    arb create ws-one repo-a
    run arb list
    [[ "$output" == *"WORKSPACE"* ]]
    [[ "$output" == *"BRANCH"* ]]
    [[ "$output" == *"REPOS"* ]]
    [[ "$output" == *"STATUS"* ]]
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

@test "arb list --quick shows workspaces without STATUS column" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    run arb list --quick
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    [[ "$output" == *"WORKSPACE"* ]]
    [[ "$output" == *"BRANCH"* ]]
    [[ "$output" == *"REPOS"* ]]
    [[ "$output" != *"STATUS"* ]]
    [[ "$output" != *"no issues"* ]]
}

@test "arb list --quick -q shorthand works" {
    arb create ws-one repo-a
    run arb list -q
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" != *"STATUS"* ]]
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
    [[ "$output" == *"Fetching"* ]]
    [[ "$output" == *"ws-one"* ]]
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
assert 'withIssues' in ws
assert 'issueLabels' in ws
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

@test "arb list --json --quick omits aggregate fields" {
    arb create my-feature repo-a
    run arb list --json --quick
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ws = data[0]
assert ws['workspace'] == 'my-feature'
assert ws['branch'] == 'my-feature'
assert ws['repoCount'] == 1
assert 'withIssues' not in ws
assert 'issueLabels' not in ws
"
}

@test "arb list --json --quick includes basic metadata" {
    arb create my-feature repo-a
    run arb list --json --quick
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

@test "arb cd with subpath prints correct worktree path" {
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

# ── status ───────────────────────────────────────────────────────

@test "arb status shows base branch name" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"main"* ]]
}

@test "arb status shows equal when on same commit as default branch" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"equal"* ]]
}

@test "arb status shows current branch name" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"my-feature"* ]]
}

@test "arb status shows origin/ prefix in remote column" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"origin/my-feature"* ]]
}

@test "arb status shows clean for repos with no local changes" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"clean"* ]]
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

@test "arb status shows up to date after push with no new commits" {
    arb create my-feature repo-a

    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"up to date"* ]]
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
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status -d shows only dirty repos" {
    arb create my-feature repo-a repo-b
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status -d
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

@test "arb status shows drifted branch in branch column" {
    arb create my-feature repo-a repo-b
    # Manually switch repo-a to a different branch
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 1 ]
    # repo-a should show experiment in branch column and origin/experiment in remote column
    [[ "$output" == *"repo-a"*"experiment"* ]]
    [[ "$output" == *"origin/experiment"* ]]
    # repo-b should show expected branch
    [[ "$output" == *"repo-b"*"my-feature"* ]]
}

@test "arb status uses configured base branch for stacked workspaces" {
    # Create a base branch with 2 unique commits in repo-a
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    echo "auth2" > "$TEST_DIR/project/.arb/repos/repo-a/auth2.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth2.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth2" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # repo-b does NOT have feat/auth — only main

    # Create stacked workspace with both repos
    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b

    # Add a commit to the feature branch in repo-a (on top of feat/auth)
    echo "ui-change" > "$TEST_DIR/project/stacked/repo-a/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-a" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-a" commit -m "ui change" >/dev/null 2>&1

    # Add a commit to the feature branch in repo-b (on top of main)
    echo "ui-change-b" > "$TEST_DIR/project/stacked/repo-b/ui.txt"
    git -C "$TEST_DIR/project/stacked/repo-b" add ui.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/stacked/repo-b" commit -m "ui change b" >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1
    run arb status

    # repo-a: should compare against feat/auth (1 ahead, not 3 ahead which it would be vs main)
    [[ "$output" == *"repo-a"*"feat/auth"*"1 ahead"* ]]

    # repo-b: base branch feat/auth doesn't exist — should fall back to main
    [[ "$output" == *"repo-b"*"main"*"1 ahead"* ]]
}

@test "default branch detection with master" {
    git init --bare "$TEST_DIR/origin/repo-master.git" -b master >/dev/null 2>&1
    git clone "$TEST_DIR/origin/repo-master.git" "$TEST_DIR/project/.arb/repos/repo-master" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-master" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1

    arb create test-master repo-master
    cd "$TEST_DIR/project/test-master"
    run arb status
    [[ "$output" == *"master"* ]]
}

@test "arb status exits 0 when all repos are clean and pushed" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

@test "arb status exits 0 when fresh branch has no commits" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"not pushed"* ]]
}

@test "arb status exits 1 when repos are dirty" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [ "$status" -eq 1 ]
    [[ "$output" == *"untracked"* ]]
}

@test "arb status --fetch fetches before showing status" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --fetch
    [[ "$output" == *"repo-a"* ]]
}

@test "arb status -f fetches before showing status" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status -f
    [[ "$output" == *"repo-a"* ]]
}

@test "arb status --verbose shows file details for dirty repos" {
    arb create my-feature repo-a
    echo "new" > "$TEST_DIR/project/my-feature/repo-a/newfile.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status --verbose
    [[ "$output" == *"Untracked files:"* ]]
    [[ "$output" == *"newfile.txt"* ]]
}

@test "arb status --verbose shows staged file names" {
    arb create my-feature repo-a
    echo "staged" > "$TEST_DIR/project/my-feature/repo-a/staged.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add staged.txt >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status --verbose
    [[ "$output" == *"Changes to be committed:"* ]]
    [[ "$output" == *"new file:"* ]]
    [[ "$output" == *"staged.txt"* ]]
}

@test "arb status shows origin to push count" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Now make another commit without pushing
    echo "more" > "$TEST_DIR/project/my-feature/repo-a/g.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add g.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "second" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"1 to push"* ]]
}

@test "arb status shows origin to pull count" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Clone a fresh copy, push a commit to origin on my-feature
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"1 to pull"* ]]
}

@test "arb status --verbose shows ahead of base section" {
    arb create my-feature repo-a
    echo "new" > "$TEST_DIR/project/my-feature/repo-a/new.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add new.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "ahead commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status --verbose
    [[ "$output" == *"Ahead of main:"* ]]
    [[ "$output" == *"ahead commit"* ]]
}

@test "arb status --verbose shows behind base section" {
    arb create my-feature repo-a

    # Add a commit to origin's default branch so we're behind
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --verbose
    [[ "$output" == *"Behind main:"* ]]
    [[ "$output" == *"upstream change"* ]]
}

@test "arb status --verbose shows unpushed to origin section" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first push" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Make another commit without pushing
    echo "unpushed" > "$TEST_DIR/project/my-feature/repo-a/g.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add g.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "unpushed commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --verbose
    [[ "$output" == *"Unpushed to origin:"* ]]
    [[ "$output" == *"unpushed commit"* ]]
}

@test "arb status --verbose shows unstaged modifications" {
    arb create my-feature repo-a
    # Create a tracked file first
    echo "orig" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add tracked.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "add tracked" >/dev/null 2>&1
    # Now modify it without staging
    echo "changed" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status --verbose
    [[ "$output" == *"Changes not staged for commit:"* ]]
    [[ "$output" == *"modified:"* ]]
    [[ "$output" == *"tracked.txt"* ]]
}

@test "arb status --json outputs valid JSON" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --json
    # Verify it's valid JSON by piping through a JSON parser
    echo "$output" | python3 -c "import sys, json; d = json.load(sys.stdin); assert d['workspace'] == 'my-feature'"
}

@test "arb status --json includes repo data" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project/my-feature"
    run arb status --json
    echo "$output" | python3 -c "import sys, json; d = json.load(sys.stdin); assert d['total'] == 2; assert len(d['repos']) == 2"
}

@test "arb status --json includes repo detail fields" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --json
    # Verify repo detail fields exist in JSON output
    echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['repos'][0]
assert 'identity' in r
assert 'headMode' in r['identity']
assert 'worktreeKind' in r['identity']
assert 'shallow' in r['identity']
assert 'conflicts' in r['local']
assert 'operation' in r
assert 'remotes' not in r, 'remotes field should not be in JSON output'
assert 'withIssues' in d
assert 'issueLabels' in d
"
}

@test "arb status --json includes identity section" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --json
    echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['repos'][0]
assert r['identity']['worktreeKind'] == 'linked', 'expected linked worktree'
assert r['identity']['headMode']['kind'] == 'attached', 'expected attached HEAD'
assert r['identity']['headMode']['branch'] == 'my-feature', 'expected my-feature branch'
assert r['identity']['shallow'] == False, 'expected not shallow'
"
}

@test "arb status shows pushed and synced repo as up to date" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
    [[ "$output" == *"clean"* ]]
}

@test "arb status shows ahead of base and pushed as up to date remote" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    echo "change2" > "$TEST_DIR/project/my-feature/repo-a/g.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add g.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "second" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"2 ahead"* ]]
    [[ "$output" == *"origin/my-feature"*"up to date"* ]]
}

@test "arb status shows diverged base counts" {
    arb create my-feature repo-a
    # Make a local commit
    echo "local" > "$TEST_DIR/project/my-feature/repo-a/local.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add local.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Advance main on origin
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"1 ahead"* ]]
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status shows detached HEAD" {
    arb create my-feature repo-a
    # Detach HEAD in the worktree
    local head_sha
    head_sha="$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse HEAD)"
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout "$head_sha" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 1 ]
    [[ "$output" == *"(detached)"* ]]
    [[ "$output" == *"detached"* ]]
}

@test "arb status detects upstream mismatch" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Create another remote branch and set upstream to it
    git -C "$TEST_DIR/project/my-feature/repo-a" push origin my-feature:other-branch >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" branch --set-upstream-to=origin/other-branch >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    # Remote column should show origin/other-branch (mismatch)
    [[ "$output" == *"origin/other-branch"* ]]
}

@test "arb status shows local repo with dirty files" {
    setup_local_repo
    arb create local-ws local-lib
    echo "dirty" > "$TEST_DIR/project/local-ws/local-lib/dirty.txt"
    cd "$TEST_DIR/project/local-ws"
    run arb status
    # Local repos should show "local" and local changes
    [[ "$output" == *"local"* ]]
    [[ "$output" == *"1 untracked"* ]]
}

@test "arb status shows multiple local change types" {
    arb create my-feature repo-a
    # Create a tracked file, commit, then modify
    echo "orig" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add tracked.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "add tracked" >/dev/null 2>&1
    # Stage a new file
    echo "staged" > "$TEST_DIR/project/my-feature/repo-a/staged.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add staged.txt >/dev/null 2>&1
    # Modify tracked file
    echo "changed" > "$TEST_DIR/project/my-feature/repo-a/tracked.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"1 staged"* ]]
    [[ "$output" == *"1 modified"* ]]
}

@test "arb status shows fell-back base branch for stacked workspace" {
    # repo-a has feat/auth, repo-b does NOT
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a repo-b
    cd "$TEST_DIR/project/stacked"
    arb fetch >/dev/null 2>&1
    run arb status
    # repo-a should show feat/auth as base
    [[ "$output" == *"repo-a"*"feat/auth"* ]]
    # repo-b should show main (fell back) — base name still appears
    [[ "$output" == *"repo-b"*"main"* ]]
}

@test "arb status with fresh workspace shows not pushed and clean" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"not pushed"* ]]
    [[ "$output" == *"clean"* ]]
}

@test "arb status with fresh workspace and one commit shows to push" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"1 ahead"* ]]
    [[ "$output" == *"1 to push"* ]]
    [[ "$output" == *"clean"* ]]
    [[ "$output" == *"with issues"* ]]
    [[ "$output" == *"unpushed"* ]]
    [ "$status" -eq 1 ]
}

@test "arb status exits 1 when not pushed with commits" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "unpushed commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 1 ]
    [[ "$output" == *"1 to push"* ]]
    [[ "$output" == *"with issues"* ]]
    [[ "$output" == *"unpushed"* ]]
}

@test "arb status detects rebase in progress" {
    arb create my-feature repo-a
    # Set up conflicting changes for rebase
    echo "base" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push a conflicting commit on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Fetch and start a rebase that will conflict
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" rebase origin/main >/dev/null 2>&1 || true

    run arb status
    [[ "$output" == *"(rebase)"* ]]
}

@test "arb status detects merge conflicts" {
    arb create my-feature repo-a
    echo "base" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push a conflicting commit on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    # Start a merge that will conflict
    git -C "$TEST_DIR/project/my-feature/repo-a" merge origin/main >/dev/null 2>&1 || true

    run arb status
    [[ "$output" == *"conflicts"* ]]
    [[ "$output" == *"(merge)"* ]]
}

@test "arb status shows UPPERCASE headers" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"REPO"* ]]
    [[ "$output" == *"BRANCH"* ]]
    [[ "$output" == *"BASE"* ]]
    [[ "$output" == *"REMOTE"* ]]
    [[ "$output" == *"LOCAL"* ]]
}

@test "arb status --at-risk shows only at-risk repos" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    echo "change" > "$TEST_DIR/project/my-feature/repo-b/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    # Both repos are clean and pushed — at-risk should show no repos
    run arb status --at-risk
    [[ "$output" == *"(no repos)"* ]]
}

@test "arb status -r shows only at-risk repos" {
    arb create my-feature repo-a repo-b
    # Make repo-a dirty (at-risk), push repo-b so it's clean and pushed (not at-risk)
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    echo "change" > "$TEST_DIR/project/my-feature/repo-b/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status -r
    # repo-a is at-risk (dirty), repo-b is not at-risk (clean + pushed)
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status column alignment with multiple repos" {
    arb create my-feature repo-a repo-b
    # Make one dirty and one clean
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [ "$status" -eq 1 ]
    # Both repos should appear
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
    # Clean repo should show "clean", dirty repo should show "untracked"
    [[ "$output" == *"clean"* ]]
    [[ "$output" == *"1 untracked"* ]]
}

# ── status summary line ──────────────────────────────────────────

@test "arb status summary shows no issues when all clean" {
    arb create my-feature repo-a repo-b
    echo "c" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "c" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    echo "c" > "$TEST_DIR/project/my-feature/repo-b/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "c" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"no issues"* ]]
}

@test "arb status summary shows no issues for fresh branch" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"no issues"* ]]
}

@test "arb status summary shows dirty" {
    arb create my-feature repo-a
    echo "c" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "c" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"with issues"* ]]
    [[ "$output" == *"dirty"* ]]
}

@test "arb status summary shows behind base" {
    arb create my-feature repo-a
    echo "c" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "c" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Add a commit to origin's default branch
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"with issues"* ]]
    [[ "$output" == *"behind base"* ]]
}

@test "arb status summary shows behind base issue" {
    arb create my-feature repo-a
    echo "c" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "c" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # Add a commit to origin's default branch so repo-a is behind base
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    local summary_line
    summary_line=$(echo "$output" | tail -1)
    [[ "$summary_line" == *"with issues"* ]]
    [[ "$summary_line" == *"behind base"* ]]
}

@test "arb status summary shows both unpushed and behind base flags" {
    arb create my-feature repo-a
    echo "c" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "c" >/dev/null 2>&1
    # Do NOT push — repo-a has an unpushed commit
    # Add a commit to origin's default branch so repo-a is also behind base
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    # With flag-based summary, both flags appear in the qualitative breakdown
    local summary_line
    summary_line=$(echo "$output" | tail -1)
    [[ "$summary_line" == *"with issues"* ]]
    [[ "$summary_line" == *"unpushed"* ]]
    [[ "$summary_line" == *"behind base"* ]]
}

@test "arb status summary shows no issues when mixed clean repos" {
    arb create my-feature repo-a repo-b
    # repo-a: pushed and clean
    echo "c" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "c" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    # repo-b: fresh branch with no commits (nothing at risk)
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"no issues"* ]]
}

@test "arb status summary respects --dirty filter" {
    arb create my-feature repo-a repo-b
    # repo-a: pushed and dirty
    echo "c" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "c" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    # repo-b: clean and not pushed (but no commits, so not unpushed)
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --dirty
    [[ "$output" == *"with issues"* ]]
    [[ "$output" == *"dirty"* ]]
}

@test "arb status summary not in --json output" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --json
    # JSON should parse cleanly without summary text contaminating stdout
    echo "$output" | python3 -c "import sys, json; json.load(sys.stdin)"
}

@test "arb status no summary for empty repos" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --dirty
    # All clean, so --dirty shows "(no repos)" and no summary
    [[ "$output" == *"(no repos)"* ]]
    [[ "$output" != *"clean"* ]]
    [[ "$output" != *"dirty"* ]]
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

@test "arb pull plan shows HEAD SHA" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a new commit from a separate clone so pull has work to do
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-pull-sha" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-pull-sha" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb pull --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
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

    # Create a conflict in repo-a via a separate clone
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone-a" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone-a" && git checkout my-feature && echo "remote change" > conflict.txt && git add conflict.txt && git commit -m "remote" && git push) >/dev/null 2>&1
    # Local conflicting commit in worktree
    echo "local change" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1

    # Push a non-conflicting commit for repo-b so it has something to pull
    git clone "$TEST_DIR/origin/repo-b.git" "$TEST_DIR/tmp-clone-b" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone-b" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    run arb pull --yes
    [ "$status" -ne 0 ]
    # repo-b was still processed successfully
    [[ "$output" == *"repo-b"* ]]
    # Conflict file details shown
    [[ "$output" == *"CONFLICT"*"conflict.txt"* ]]
    # Consolidated conflict report
    [[ "$output" == *"1 conflicted"* ]]
    [[ "$output" == *"Pulled 1 repo"* ]]
}

@test "arb pull skips repo on wrong branch" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1
    # Manually switch repo-a to a different branch
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb pull --yes
    [[ "$output" == *"on branch experiment, expected my-feature"* ]]
    [[ "$output" == *"skipped"* ]]
    # repo-b should still appear in plan
    [[ "$output" == *"repo-b"* ]]
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
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]
    # Verify the branch exists on the remote
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/my-feature"
    [ "$status" -eq 0 ]
}

@test "arb push plan shows HEAD SHA" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb push --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
}

@test "arb push skips local repos" {
    setup_local_repo
    arb create push-ws local-lib
    cd "$TEST_DIR/project/push-ws"
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"local repo"* ]]
    [[ "$output" == *"skipped"* ]]
}

@test "arb push skips repo on wrong branch" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --yes
    [[ "$output" == *"on branch experiment, expected my-feature"* ]]
    [[ "$output" == *"skipped"* ]]
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
    [[ "$output" == *"repo-b"* ]]
}

@test "arb -w flag overrides cwd detection" {
    arb create ws-one repo-a
    arb create ws-two repo-b
    cd "$TEST_DIR/project/ws-one"
    run arb -w ws-two status
    [[ "$output" == *"repo-b"* ]]
}

@test "arb --workspace with nonexistent workspace fails" {
    run arb -w ghost status
    [ "$status" -ne 0 ]
    [[ "$output" == *"does not exist"* ]]
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

# ── --base option (stacked PRs) ──────────────────────────────────

@test "arb create --base stores base in config" {
    arb create stacked --base feat/auth -b feat/auth-ui --all-repos
    run cat "$TEST_DIR/project/stacked/.arbws/config"
    [[ "$output" == *"branch = feat/auth-ui"* ]]
    [[ "$output" == *"base = feat/auth"* ]]
}

@test "arb create --base branches from the specified base" {
    # Create a base branch with unique content
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth-content" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "add auth" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    # Create stacked workspace branching from feat/auth
    arb create stacked --base feat/auth -b feat/auth-ui repo-a
    # Content from the base branch should be present
    [ -f "$TEST_DIR/project/stacked/repo-a/auth.txt" ]
    run cat "$TEST_DIR/project/stacked/repo-a/auth.txt"
    [[ "$output" == *"auth-content"* ]]
}

@test "arb create without --base has no base key in config" {
    arb create no-base -b feat/plain --all-repos
    run cat "$TEST_DIR/project/no-base/.arbws/config"
    [[ "$output" == *"branch = feat/plain"* ]]
    [[ "$output" != *"base ="* ]]
}

@test "arb create --base with invalid branch name fails" {
    run arb create bad-base --base "bad branch name" -b feat/ok repo-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid base branch name"* ]]
}

@test "arb add respects stored base branch" {
    # Create a base branch with unique content in both repos
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/base >/dev/null 2>&1
    echo "base-a" > "$TEST_DIR/project/.arb/repos/repo-a/base.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add base.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/base >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout -b feat/base >/dev/null 2>&1
    echo "base-b" > "$TEST_DIR/project/.arb/repos/repo-b/base.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-b" add base.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" push -u origin feat/base >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b" checkout --detach >/dev/null 2>&1

    # Create workspace with --base, only including repo-a initially
    arb create stacked --base feat/base -b feat/stacked repo-a
    [ -f "$TEST_DIR/project/stacked/repo-a/base.txt" ]

    # Now add repo-b — should also branch from feat/base
    cd "$TEST_DIR/project/stacked"
    arb add repo-b
    [ -f "$TEST_DIR/project/stacked/repo-b/base.txt" ]
    run cat "$TEST_DIR/project/stacked/repo-b/base.txt"
    [[ "$output" == *"base-b"* ]]
}

@test "arb create --base falls back to default branch when base missing" {
    # repo-a and repo-b do NOT have feat/auth — only their default branch
    run arb create stacked --base feat/auth -b feat/auth-ui --all-repos
    [ "$status" -eq 0 ]
    # Should warn about the missing base branch for each repo
    [[ "$output" == *"base branch 'feat/auth' not found"* ]]
    # Worktrees should still be created (branched from default)
    [ -d "$TEST_DIR/project/stacked/repo-a" ]
    [ -d "$TEST_DIR/project/stacked/repo-b" ]
    local branch
    branch="$(git -C "$TEST_DIR/project/stacked/repo-a" branch --show-current)"
    [ "$branch" = "feat/auth-ui" ]
}

@test "arb add falls back to default branch when workspace base missing in repo" {
    # Create workspace with a base that exists only in repo-a
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/base >/dev/null 2>&1
    echo "base-a" > "$TEST_DIR/project/.arb/repos/repo-a/base.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add base.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "base" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/base >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/base -b feat/stacked repo-a
    [ -f "$TEST_DIR/project/stacked/repo-a/base.txt" ]

    # repo-b does NOT have feat/base — add should fall back with warning
    cd "$TEST_DIR/project/stacked"
    run arb add repo-b
    [ "$status" -eq 0 ]
    [[ "$output" == *"base branch 'feat/base' not found"* ]]
    [ -d "$TEST_DIR/project/stacked/repo-b" ]
    local branch
    branch="$(git -C "$TEST_DIR/project/stacked/repo-b" branch --show-current)"
    [ "$branch" = "feat/stacked" ]
}

# ── rebase ───────────────────────────────────────────────────────

@test "arb rebase rebases feature branch onto updated base" {
    arb create my-feature repo-a repo-b

    # Push a commit to main on origin for repo-a
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetching"* ]]
    [[ "$output" == *"Rebased"* ]]

    # Verify the upstream commit is now reachable from the feature branch
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream change"* ]]
}

@test "arb rebase plan shows HEAD SHA" {
    arb create my-feature repo-a

    # Push upstream change so rebase has work to do
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb rebase --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
}

@test "arb rebase shows up to date when nothing to do" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

@test "arb rebase skips dirty repos" {
    arb create my-feature repo-a

    # Push upstream change
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Make worktree dirty
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [[ "$output" == *"skipped"* ]]
    [[ "$output" == *"uncommitted changes"* ]]
}

@test "arb rebase skips wrong branch" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    git -C "$TEST_DIR/project/my-feature/repo-a" checkout -b experiment >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [[ "$output" == *"skipped"* ]]
    [[ "$output" == *"expected my-feature"* ]]
}

@test "arb rebase continues past conflict and shows consolidated report" {
    arb create my-feature repo-a repo-b

    # Create conflicting changes in repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream conflict" && git push) >/dev/null 2>&1

    # Push an upstream change to repo-b (no conflict)
    (cd "$TEST_DIR/project/.arb/repos/repo-b" && echo "upstream-ok" > ok.txt && git add ok.txt && git commit -m "upstream ok" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase repo-a repo-b --yes
    [ "$status" -ne 0 ]
    # Conflict file details shown
    [[ "$output" == *"CONFLICT"*"conflict.txt"* ]]
    # Conflict instructions shown
    [[ "$output" == *"conflict"* ]]
    [[ "$output" == *"git rebase --continue"* ]]
    [[ "$output" == *"git rebase --abort"* ]]
    # repo-b was still processed successfully
    [[ "$output" == *"Rebased 1 repo, 1 conflicted"* ]]
}

@test "arb rebase with specific repos only processes those repos" {
    arb create my-feature repo-a repo-b

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase repo-a --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased 1 repo"* ]]
    # repo-b should not appear in output
    [[ "$output" != *"repo-b"* ]]
}

@test "arb rebase --yes skips confirmation" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased"* ]]
}

@test "arb rebase non-TTY without --yes errors" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Pipe to force non-TTY
    run bash -c 'echo "" | arb rebase'
    [ "$status" -ne 0 ]
    [[ "$output" == *"Not a terminal"* ]] || [[ "$output" == *"--yes"* ]]
}

@test "arb rebase --no-fetch skips fetching" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Fetch manually so rebase has fresh refs, then test --no-fetch skips fetching
    arb fetch >/dev/null 2>&1
    run arb rebase --no-fetch --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetching"* ]]
    [[ "$output" == *"Rebased"* ]]
}

@test "arb rebase -F skips fetching" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb rebase -F --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetching"* ]]
    [[ "$output" == *"Rebased"* ]]
}

@test "arb rebase with custom base branch" {
    # Create a base branch with a commit
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout -b feat/auth >/dev/null 2>&1
    echo "auth" > "$TEST_DIR/project/.arb/repos/repo-a/auth.txt"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" add auth.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" commit -m "auth feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" push -u origin feat/auth >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" checkout --detach >/dev/null 2>&1

    arb create stacked --base feat/auth -b feat/auth-ui repo-a

    # Push a new commit to feat/auth on origin
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout feat/auth && echo "new-auth" > new-auth.txt && git add new-auth.txt && git commit -m "new auth commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/stacked"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"rebase feat/auth-ui onto"*"feat/auth"* ]]
    [[ "$output" == *"Rebased"* ]]

    # Verify the upstream commit is reachable
    run git -C "$TEST_DIR/project/stacked/repo-a" log --oneline
    [[ "$output" == *"new auth commit"* ]]
}

@test "arb rebase skips in-progress operation" {
    arb create my-feature repo-a

    # Create conflicting changes for a manual rebase
    echo "base" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "base" >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    # Start a rebase that will conflict (need fresh refs for manual git rebase)
    git -C "$TEST_DIR/project/my-feature/repo-a" rebase origin/main >/dev/null 2>&1 || true

    run arb rebase --yes
    [[ "$output" == *"skipped"* ]]
    [[ "$output" == *"rebase in progress"* ]]
}

# ── merge ────────────────────────────────────────────────────────

@test "arb merge merges base branch into feature branch" {
    arb create my-feature repo-a repo-b

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetching"* ]]
    [[ "$output" == *"Merged"* ]]

    # Verify merge commit exists
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" == *"upstream change"* ]]
}

@test "arb merge plan shows HEAD SHA" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    expected_sha=$(git -C "$TEST_DIR/project/my-feature/repo-a" rev-parse --short HEAD)
    run arb merge --yes
    [[ "$output" == *"HEAD $expected_sha"* ]]
}

@test "arb merge shows up to date when nothing to do" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

@test "arb merge continues past conflict and shows consolidated report" {
    arb create my-feature repo-a repo-b

    # Create conflicting changes in repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/conflict.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add conflict.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream-conflict" > conflict.txt && git add conflict.txt && git commit -m "upstream conflict" && git push) >/dev/null 2>&1

    # Push an upstream change to repo-b (no conflict)
    (cd "$TEST_DIR/project/.arb/repos/repo-b" && echo "upstream-ok" > ok.txt && git add ok.txt && git commit -m "upstream ok" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb merge repo-a repo-b --yes
    [ "$status" -ne 0 ]
    # Conflict file details shown
    [[ "$output" == *"CONFLICT"*"conflict.txt"* ]]
    # Conflict instructions shown
    [[ "$output" == *"conflict"* ]]
    [[ "$output" == *"git merge --continue"* ]]
    [[ "$output" == *"git merge --abort"* ]]
    # repo-b was still processed successfully
    [[ "$output" == *"Merged 1 repo, 1 conflicted"* ]]
}

@test "arb merge -F skips fetching" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb merge -F --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetching"* ]]
    [[ "$output" == *"Merged"* ]]
}

@test "arb merge --no-fetch skips fetching" {
    arb create my-feature repo-a

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb merge --no-fetch --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetching"* ]]
    [[ "$output" == *"Merged"* ]]
}

# ── pull (plan+confirm) ─────────────────────────────────────────

@test "arb pull --yes skips confirmation" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a new commit from another clone
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pulled"* ]]
    [[ "$output" == *"to pull"* ]]
}

@test "arb pull shows plan before pulling" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

# ── push (plan+confirm) ─────────────────────────────────────────

@test "arb push --yes skips confirmation" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]
    [[ "$output" == *"to push"* ]]
}

@test "arb push shows plan before pushing" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    echo "more" > "$TEST_DIR/project/my-feature/repo-a/file2.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file2.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "more" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"1 commit"* ]]
    [[ "$output" == *"Pushed"* ]]
}

@test "arb push first push shows correct commit count and new branch annotation" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"1 commit"* ]]
    [[ "$output" == *"new branch"* ]]
    [[ "$output" != *"2 commit"* ]]
}

@test "arb push fetches by default" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetching"* ]]
    [[ "$output" == *"Pushed"* ]]
}

@test "arb push --no-fetch skips fetching" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --no-fetch --yes
    [ "$status" -eq 0 ]
    [[ "$output" != *"Fetching"* ]]
    [[ "$output" == *"Pushed"* ]]
}

# ── push [repos...] and --force ─────────────────────────────────

@test "arb push repo-a --yes only pushes named repo" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    echo "change" > "$TEST_DIR/project/my-feature/repo-b/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push repo-a --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed 1 repo"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb push --force pushes diverged repo after rebase" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push an upstream change to main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Rebase the feature branch (auto-fetches)
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    # Now push with --force
    run arb push --force --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"force"* ]]
    [[ "$output" == *"Pushed"* ]]
}

@test "arb push skips diverged repo without --force" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push upstream change and rebase (auto-fetches)
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    # Push without --force should skip
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"diverged from origin"* ]]
    [[ "$output" == *"--force"* ]]
}

@test "arb push -f short flag works" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    run arb push -f --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]
}

@test "arb push nonexistent repo errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb push nonexistent-repo --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"not in this workspace"* ]]
}

@test "arb push --force on non-diverged repo does normal push" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --force --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]
}

# ── pull [repos...] ─────────────────────────────────────────────

@test "arb pull repo-a --yes only pulls named repo" {
    arb create my-feature repo-a repo-b
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1

    # Push a remote commit to repo-a
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone-a" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone-a" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull repo-a --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pulled 1 repo"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb pull nonexistent repo errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb pull nonexistent-repo --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"not in this workspace"* ]]
}

# ── rebase+push end-to-end ──────────────────────────────────────

@test "arb rebase then push --force end-to-end" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Rebased"* ]]

    run arb push --force --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]

    # Verify remote has both commits
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch origin my-feature
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" log --oneline origin/my-feature
    [[ "$output" == *"feature"* ]]
    [[ "$output" == *"upstream"* ]]
}

# ── pull --rebase / --merge ──────────────────────────────────────

@test "arb pull defaults to merge mode in plan and result" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"to pull (merge)"* ]]
    [[ "$output" == *"(merge)"* ]]
}

@test "arb pull detects rebase from pull.rebase config" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    git -C "$TEST_DIR/project/my-feature/repo-a" config pull.rebase true

    cd "$TEST_DIR/project/my-feature"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"to pull (rebase)"* ]]
    [[ "$output" == *"(rebase)"* ]]
}

@test "arb pull --rebase forces rebase mode" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"to pull (rebase)"* ]]
    [[ "$output" == *"(rebase)"* ]]
}

@test "arb pull --merge forces merge mode" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    # Set rebase in config, but --merge flag should override
    git -C "$TEST_DIR/project/my-feature/repo-a" config pull.rebase true

    cd "$TEST_DIR/project/my-feature"
    run arb pull --merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"to pull (merge)"* ]]
    [[ "$output" == *"(merge)"* ]]
}

@test "arb pull --rebase --merge errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb pull --rebase --merge --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot use both --rebase and --merge"* ]]
}

# ── fork workflow (multiple remotes) ─────────────────────────────

# Helper: set up a fork repo with upstream + origin (fork)
# Creates bare "upstream" and "fork" repos, clones fork into .arb/repos/
# with upstream remote and remote.pushDefault = origin
setup_fork_repo() {
    local name="$1"
    local upstream_dir="$TEST_DIR/upstream/${name}.git"
    local fork_dir="$TEST_DIR/fork/${name}.git"
    local repo_dir="$TEST_DIR/project/.arb/repos/${name}"

    # Create upstream bare repo with initial commit
    git init --bare "$upstream_dir" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-${name}"
    git clone "$upstream_dir" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    # Create fork by cloning upstream
    git clone --bare "$upstream_dir" "$fork_dir" >/dev/null 2>&1

    # Remove existing repo if any (from setup)
    rm -rf "$repo_dir"

    # Clone fork as origin into .arb/repos/
    git clone "$fork_dir" "$repo_dir" >/dev/null 2>&1

    # Add upstream remote and set pushDefault
    git -C "$repo_dir" remote add upstream "$upstream_dir"
    git -C "$repo_dir" config remote.pushDefault origin
    git -C "$repo_dir" fetch upstream >/dev/null 2>&1
    git -C "$repo_dir" remote set-head upstream --auto >/dev/null 2>&1
}

@test "arb clone --upstream sets up fork layout" {
    git init --bare "$TEST_DIR/upstream/clone-fork.git" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-clone-fork"
    git clone "$TEST_DIR/upstream/clone-fork.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"
    git clone --bare "$TEST_DIR/upstream/clone-fork.git" "$TEST_DIR/fork/clone-fork.git" >/dev/null 2>&1

    run arb clone "$TEST_DIR/fork/clone-fork.git" clone-fork --upstream "$TEST_DIR/upstream/clone-fork.git"
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/.arb/repos/clone-fork/.git" ]

    # Verify remotes are set up
    local remotes
    remotes="$(git -C "$TEST_DIR/project/.arb/repos/clone-fork" remote)"
    [[ "$remotes" == *"origin"* ]]
    [[ "$remotes" == *"upstream"* ]]

    # Verify remote.pushDefault
    local push_default
    push_default="$(git -C "$TEST_DIR/project/.arb/repos/clone-fork" config remote.pushDefault)"
    [ "$push_default" = "origin" ]
}

@test "fork: create workspace branches from upstream" {
    setup_fork_repo repo-a

    # Add a commit to upstream that fork doesn't have
    local tmp_clone="$TEST_DIR/tmp-upstream-commit"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream-content" > upstream.txt && git add upstream.txt && git commit -m "upstream commit" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    # Fetch upstream in canonical repo
    git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch upstream >/dev/null 2>&1

    arb create fork-ws repo-a

    # Worktree should have the upstream commit (branched from upstream/main)
    [ -f "$TEST_DIR/project/fork-ws/repo-a/upstream.txt" ]
}

@test "fork: push targets the publish remote (origin/fork)" {
    setup_fork_repo repo-a
    arb create fork-push repo-a
    cd "$TEST_DIR/project/fork-push"

    # Make a commit
    (cd repo-a && echo "feature" > feature.txt && git add feature.txt && git commit -m "feature commit") >/dev/null 2>&1

    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]

    # Branch should exist on fork (origin), not on upstream
    local fork_branch
    fork_branch="$(git -C "$TEST_DIR/fork/repo-a.git" branch)"
    [[ "$fork_branch" == *"fork-push"* ]]
}

@test "fork: rebase targets the upstream remote" {
    setup_fork_repo repo-a
    arb create fork-rebase repo-a

    # Add commits to upstream after workspace creation
    local tmp_clone="$TEST_DIR/tmp-upstream-rebase"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream-update" > update.txt && git add update.txt && git commit -m "upstream update" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-rebase"
    run arb rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"rebased fork-rebase onto upstream/main"* ]] || [[ "$output" == *"Rebased"* ]]

    # Workspace should now have the upstream commit
    [ -f "$TEST_DIR/project/fork-rebase/repo-a/update.txt" ]
}

@test "fork: fetch fetches both remotes" {
    setup_fork_repo repo-a
    arb create fork-fetch repo-a

    # Add a commit to upstream
    local tmp_clone="$TEST_DIR/tmp-upstream-fetch"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "new" > new.txt && git add new.txt && git commit -m "new on upstream" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-fetch"
    run arb fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched"* ]]

    # upstream/main should have the new commit
    local upstream_log
    upstream_log="$(git -C "$TEST_DIR/project/.arb/repos/repo-a" log --oneline upstream/main)"
    [[ "$upstream_log" == *"new on upstream"* ]]
}

@test "fork: status shows upstream remote in BASE column" {
    setup_fork_repo repo-a
    arb create fork-status repo-a
    cd "$TEST_DIR/project/fork-status"

    run arb status
    # BASE column should show upstream/main since upstream ≠ publish
    [[ "$output" == *"upstream/main"* ]]
    # REMOTE column should show origin/<branch>
    [[ "$output" == *"origin/fork-status"* ]]
}

@test "fork: remove --delete-remote deletes from publish remote" {
    setup_fork_repo repo-a
    arb create fork-remove repo-a

    # Push the branch first
    (cd "$TEST_DIR/project/fork-remove/repo-a" && echo "x" > x.txt && git add x.txt && git commit -m "x" && git push -u origin fork-remove) >/dev/null 2>&1

    # Verify branch exists on fork
    run git -C "$TEST_DIR/fork/repo-a.git" branch
    [[ "$output" == *"fork-remove"* ]]

    run arb remove fork-remove --force --delete-remote
    [ "$status" -eq 0 ]

    # Branch should be deleted from fork
    run git -C "$TEST_DIR/fork/repo-a.git" branch
    [[ "$output" != *"fork-remove"* ]]

    # Branch should NOT have been deleted from upstream
    run git -C "$TEST_DIR/upstream/repo-a.git" branch
    [[ "$output" != *"fork-remove"* ]]
}

@test "fork: mixed workspace — some repos forked, some single-origin" {
    setup_fork_repo repo-a
    # repo-b keeps its single-origin setup from the main setup()

    arb create mixed-ws repo-a repo-b
    cd "$TEST_DIR/project/mixed-ws"

    run arb status
    # repo-a should show upstream/main, repo-b should show just main
    [[ "$output" == *"upstream/main"* ]]
}

@test "fork: convention detection — upstream remote without pushDefault" {
    # Set up a repo with upstream remote but without pushDefault
    local upstream_dir="$TEST_DIR/upstream/conv-test.git"
    local fork_dir="$TEST_DIR/fork/conv-test.git"

    git init --bare "$upstream_dir" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-conv"
    git clone "$upstream_dir" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    git clone --bare "$upstream_dir" "$fork_dir" >/dev/null 2>&1
    git clone "$fork_dir" "$TEST_DIR/project/.arb/repos/conv-test" >/dev/null 2>&1

    # Add upstream remote but do NOT set pushDefault — relies on convention
    git -C "$TEST_DIR/project/.arb/repos/conv-test" remote add upstream "$upstream_dir"
    git -C "$TEST_DIR/project/.arb/repos/conv-test" fetch upstream >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/conv-test" remote set-head upstream --auto >/dev/null 2>&1

    arb create conv-ws conv-test
    cd "$TEST_DIR/project/conv-ws"

    run arb status
    [[ "$output" == *"upstream/main"* ]]
}

@test "fork: non-standard remote names with pushDefault" {
    local canonical_dir="$TEST_DIR/upstream/custom-names.git"
    local fork_dir="$TEST_DIR/fork/custom-names.git"

    git init --bare "$canonical_dir" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-custom"
    git clone "$canonical_dir" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    git clone --bare "$canonical_dir" "$fork_dir" >/dev/null 2>&1
    git clone "$fork_dir" "$TEST_DIR/project/.arb/repos/custom-names" >/dev/null 2>&1

    # Add canonical remote (not named "upstream") and set pushDefault
    git -C "$TEST_DIR/project/.arb/repos/custom-names" remote add canonical "$canonical_dir"
    git -C "$TEST_DIR/project/.arb/repos/custom-names" config remote.pushDefault origin
    git -C "$TEST_DIR/project/.arb/repos/custom-names" fetch canonical >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/custom-names" remote set-head canonical --auto >/dev/null 2>&1

    arb create custom-ws custom-names
    cd "$TEST_DIR/project/custom-ws"

    run arb status
    # Should show canonical/main since canonical is the upstream remote
    [[ "$output" == *"canonical/main"* ]]
}

@test "fork: single-origin repos behave identically" {
    # Create a workspace with standard single-origin repo
    arb create single-origin-ws repo-a repo-b
    cd "$TEST_DIR/project/single-origin-ws"

    run arb status
    # BASE column should NOT show origin/ prefix (single-origin keeps it clean)
    [[ "$output" != *"origin/main"* ]]
    # Should just show "main" in the base column
    [[ "$output" == *"main"* ]]
}

@test "fork: merge targets the upstream remote" {
    setup_fork_repo repo-a
    arb create fork-merge repo-a

    # Add commits to upstream after workspace creation
    local tmp_clone="$TEST_DIR/tmp-upstream-merge"
    git clone "$TEST_DIR/upstream/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream-merge-update" > merge-update.txt && git add merge-update.txt && git commit -m "upstream merge update" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-merge"
    run arb merge --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"merged upstream/main into fork-merge"* ]] || [[ "$output" == *"Merged"* ]]

    # Workspace should now have the upstream commit
    [ -f "$TEST_DIR/project/fork-merge/repo-a/merge-update.txt" ]
}

@test "fork: ambiguous remotes error with 3 remotes and no pushDefault" {
    # Set up a repo with 3 remotes and no pushDefault or "upstream" name
    local bare_a="$TEST_DIR/upstream/ambig.git"
    local bare_b="$TEST_DIR/fork/ambig.git"
    local bare_c="$TEST_DIR/staging/ambig.git"

    git init --bare "$bare_a" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-ambig"
    git clone "$bare_a" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    git clone --bare "$bare_a" "$bare_b" >/dev/null 2>&1
    mkdir -p "$TEST_DIR/staging"
    git clone --bare "$bare_a" "$bare_c" >/dev/null 2>&1

    git clone "$bare_b" "$TEST_DIR/project/.arb/repos/ambig" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/ambig" remote add canonical "$bare_a"
    git -C "$TEST_DIR/project/.arb/repos/ambig" remote add staging "$bare_c"

    # No pushDefault set, no "upstream" name — should be ambiguous
    # Create still works (falls back to origin for remote operations)
    run arb create ambig-ws ambig
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/ambig-ws/ambig" ]

    # Status runs without crashing (exit 0 — fresh branch with no commits is not unpushed)
    cd "$TEST_DIR/project/ambig-ws"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"ambig"* ]]
}

@test "fork: pull syncs from publish remote" {
    setup_fork_repo repo-a
    arb create fork-pull repo-a

    # Push the branch to the fork (origin)
    (cd "$TEST_DIR/project/fork-pull/repo-a" && echo "initial" > init.txt && git add init.txt && git commit -m "initial" && git push -u origin fork-pull) >/dev/null 2>&1

    # Simulate someone else pushing to the fork
    local tmp_clone="$TEST_DIR/tmp-fork-pull"
    git clone "$TEST_DIR/fork/repo-a.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git checkout fork-pull && echo "from-fork" > fork-change.txt && git add fork-change.txt && git commit -m "fork commit" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    cd "$TEST_DIR/project/fork-pull"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pulled"* ]]

    # Should have the fork commit
    [ -f "$TEST_DIR/project/fork-pull/repo-a/fork-change.txt" ]
}

@test "fork: arb add in fork workspace sets up remotes correctly" {
    setup_fork_repo repo-a

    # Set up a second fork repo
    local upstream_b="$TEST_DIR/upstream/repo-b-fork.git"
    local fork_b="$TEST_DIR/fork/repo-b-fork.git"

    git init --bare "$upstream_b" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-repo-b-fork"
    git clone "$upstream_b" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && echo "upstream content" > file.txt && git add file.txt && git commit -m "upstream init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"
    git clone --bare "$upstream_b" "$fork_b" >/dev/null 2>&1

    # Clone fork as the canonical repo
    rm -rf "$TEST_DIR/project/.arb/repos/repo-b-fork"
    git clone "$fork_b" "$TEST_DIR/project/.arb/repos/repo-b-fork" >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" remote add upstream "$upstream_b"
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" config remote.pushDefault origin
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" fetch upstream >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-b-fork" remote set-head upstream --auto >/dev/null 2>&1

    # Create workspace with repo-a only
    arb create fork-add repo-a

    # Add the second fork repo
    cd "$TEST_DIR/project/fork-add"
    run arb add repo-b-fork
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/fork-add/repo-b-fork" ]

    # Verify the branch was created from upstream (has upstream content)
    [ -f "$TEST_DIR/project/fork-add/repo-b-fork/file.txt" ]
}

@test "fork: clone --upstream fails gracefully with bad upstream URL" {
    git init --bare "$TEST_DIR/fork/bad-upstream.git" -b main >/dev/null 2>&1
    local tmp_clone="$TEST_DIR/tmp-bad-upstream"
    git clone "$TEST_DIR/fork/bad-upstream.git" "$tmp_clone" >/dev/null 2>&1
    (cd "$tmp_clone" && git commit --allow-empty -m "init" && git push) >/dev/null 2>&1
    rm -rf "$tmp_clone"

    run arb clone "$TEST_DIR/fork/bad-upstream.git" bad-upstream --upstream "/nonexistent/path/repo.git"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Failed to fetch upstream"* ]]
}

# ── gone remote branches ─────────────────────────────────────────

# Helper: push a workspace branch via arb, then delete it on the bare remote
push_then_delete_remote() {
    local ws="$1" repo="$2"
    local wt="$TEST_DIR/project/$ws/$repo"
    echo "change" > "$wt/file.txt"
    git -C "$wt" add file.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    (cd "$TEST_DIR/project/$ws" && arb push --yes) >/dev/null 2>&1
    # Delete the branch on the bare remote (simulates GitHub auto-delete after merge)
    git -C "$TEST_DIR/origin/$repo.git" branch -D "$ws" >/dev/null 2>&1
    # Prune so the local tracking ref is gone
    git -C "$TEST_DIR/project/.arb/repos/$repo" fetch --prune >/dev/null 2>&1
}

@test "arb fetch prunes deleted remote branches" {
    arb create gone-fetch repo-a
    local wt="$TEST_DIR/project/gone-fetch/repo-a"
    echo "change" > "$wt/file.txt"
    git -C "$wt" add file.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/gone-fetch"
    arb push --yes >/dev/null 2>&1

    # Verify tracking ref exists before
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/gone-fetch"
    [ "$status" -eq 0 ]

    # Delete on bare remote
    git -C "$TEST_DIR/origin/repo-a.git" branch -D gone-fetch >/dev/null 2>&1

    # Fetch should prune the stale tracking ref
    arb fetch

    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/gone-fetch"
    [ "$status" -ne 0 ]
}

@test "arb status shows gone for deleted remote branch" {
    arb create gone-status repo-a repo-b
    push_then_delete_remote gone-status repo-a

    cd "$TEST_DIR/project/gone-status"
    run arb status
    [[ "$output" == *"gone"* ]]
    [[ "$output" != *"not pushed"* ]]
}

@test "arb status exits 1 for gone repos with unpushed commits" {
    arb create gone-exit repo-a
    push_then_delete_remote gone-exit repo-a

    cd "$TEST_DIR/project/gone-exit"
    run arb status
    [ "$status" -eq 1 ]
    [[ "$output" == *"gone"* ]]
    [[ "$output" == *"to push"* ]]
}

@test "arb push recreates gone remote branches" {
    arb create gone-push repo-a
    push_then_delete_remote gone-push repo-a
    cd "$TEST_DIR/project/gone-push"
    run arb push --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"(recreate)"* ]]
    [[ "$output" == *"pushed"* ]]
    # Verify the remote branch was actually recreated
    run git -C "$TEST_DIR/origin/repo-a.git" branch --list gone-push
    [[ "$output" == *"gone-push"* ]]
}

@test "arb pull skips gone repos" {
    arb create gone-pull repo-a
    push_then_delete_remote gone-pull repo-a

    cd "$TEST_DIR/project/gone-pull"
    run arb pull --yes
    [[ "$output" == *"remote branch gone"* ]]
}

@test "arb remove treats gone repos as safe" {
    arb create gone-remove repo-a
    push_then_delete_remote gone-remove repo-a

    run arb remove gone-remove --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/gone-remove" ]
}

# ── remove --all-ok ──────────────────────────────────────────────

@test "arb remove --all-ok removes ok workspaces, keeps dirty" {
    arb create ws-clean repo-a
    arb create ws-dirty repo-a

    # Push ws-clean so it's "ok"
    git -C "$TEST_DIR/project/ws-clean/repo-a" push -u origin ws-clean >/dev/null 2>&1

    # Push ws-dirty then dirty it up
    git -C "$TEST_DIR/project/ws-dirty/repo-a" push -u origin ws-dirty >/dev/null 2>&1
    echo "uncommitted" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"

    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-clean" ]
    [ -d "$TEST_DIR/project/ws-dirty" ]
}

@test "arb remove --all-ok skips current workspace" {
    arb create ws-inside repo-a
    git -C "$TEST_DIR/project/ws-inside/repo-a" push -u origin ws-inside >/dev/null 2>&1

    cd "$TEST_DIR/project/ws-inside"
    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/ws-inside" ]
}

@test "arb remove --all-ok with no ok workspaces exits cleanly" {
    arb create ws-dirty repo-a
    git -C "$TEST_DIR/project/ws-dirty/repo-a" push -u origin ws-dirty >/dev/null 2>&1
    echo "uncommitted" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"

    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"No workspaces with ok status"* ]]
    [ -d "$TEST_DIR/project/ws-dirty" ]
}

@test "arb remove --all-ok with positional args errors" {
    run arb remove --all-ok ws-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --all-ok with workspace names"* ]]
}

@test "arb remove --all-ok --force skips confirmation" {
    arb create ws-ok repo-a
    git -C "$TEST_DIR/project/ws-ok/repo-a" push -u origin ws-ok >/dev/null 2>&1

    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-ok" ]
}

@test "arb remove --all-ok skips config-missing workspaces" {
    arb create ws-broken repo-a
    git -C "$TEST_DIR/project/ws-broken/repo-a" push -u origin ws-broken >/dev/null 2>&1
    # Remove config to simulate config-missing state
    rm "$TEST_DIR/project/ws-broken/.arbws/config"

    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"No workspaces with ok status"* ]]
    [ -d "$TEST_DIR/project/ws-broken" ]
}

@test "arb remove --all-ok --delete-remote composes correctly" {
    arb create ws-rd repo-a
    git -C "$TEST_DIR/project/ws-rd/repo-a" push -u origin ws-rd >/dev/null 2>&1

    run arb remove --all-ok --force --delete-remote
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-rd" ]
    # Remote branch should be gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/ws-rd"
    [ "$status" -ne 0 ]
}

@test "arb remove --all-ok includes workspaces that are behind base" {
    arb create ws-behind repo-a
    git -C "$TEST_DIR/project/ws-behind/repo-a" push -u origin ws-behind >/dev/null 2>&1

    # Advance the remote's default branch so ws-behind is behind base
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "advance" > advance.txt && git add advance.txt && git commit -m "advance main" && git push) >/dev/null 2>&1

    # Fetch so the workspace sees the new remote state
    git -C "$TEST_DIR/project/ws-behind/repo-a" fetch origin >/dev/null 2>&1

    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-behind" ]
}

# ── templates ─────────────────────────────────────────────────────

@test "arb init creates .arb/.gitignore with repos/ entry" {
    local dir="$TEST_DIR/init-gitignore"
    mkdir -p "$dir"
    cd "$dir"
    arb init
    [ -f "$dir/.arb/.gitignore" ]
    run cat "$dir/.arb/.gitignore"
    [[ "$output" == *"repos/"* ]]
}

@test "arb create applies workspace templates" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "ws-file" > "$TEST_DIR/project/.arb/templates/workspace/setup.txt"

    arb create tpl-ws-test repo-a
    [ -f "$TEST_DIR/project/tpl-ws-test/setup.txt" ]
    run cat "$TEST_DIR/project/tpl-ws-test/setup.txt"
    [[ "$output" == "ws-file" ]]
}

@test "arb create applies repo templates" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-repo-test repo-a
    [ -f "$TEST_DIR/project/tpl-repo-test/repo-a/.env" ]
    run cat "$TEST_DIR/project/tpl-repo-test/repo-a/.env"
    [[ "$output" == "DB=localhost" ]]
}

@test "arb create applies nested template directory structure" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace/.claude"
    echo '{"key":"val"}' > "$TEST_DIR/project/.arb/templates/workspace/.claude/settings.local.json"

    arb create tpl-nested-test repo-a
    [ -f "$TEST_DIR/project/tpl-nested-test/.claude/settings.local.json" ]
    run cat "$TEST_DIR/project/tpl-nested-test/.claude/settings.local.json"
    [[ "$output" == '{"key":"val"}' ]]
}

@test "template files are not overwritten if they already exist" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "template-content" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-nooverwrite repo-a
    # Overwrite the seeded file
    echo "custom-content" > "$TEST_DIR/project/tpl-nooverwrite/repo-a/.env"

    # Add repo-b to trigger template application again (repo-a already has the file)
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-b"
    echo "b-env" > "$TEST_DIR/project/.arb/templates/repos/repo-b/.env"
    cd "$TEST_DIR/project/tpl-nooverwrite"
    arb add repo-b

    # repo-a's file should still have the custom content
    run cat "$TEST_DIR/project/tpl-nooverwrite/repo-a/.env"
    [[ "$output" == "custom-content" ]]
}

@test "arb create works without templates directory" {
    # No templates dir exists — should succeed silently
    run arb create tpl-none-test repo-a
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/tpl-none-test/repo-a" ]
}

@test "arb add applies repo templates for newly added repos" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-b"
    echo "ADDED=true" > "$TEST_DIR/project/.arb/templates/repos/repo-b/.env"

    arb create tpl-add-test repo-a
    cd "$TEST_DIR/project/tpl-add-test"
    arb add repo-b

    [ -f "$TEST_DIR/project/tpl-add-test/repo-b/.env" ]
    run cat "$TEST_DIR/project/tpl-add-test/repo-b/.env"
    [[ "$output" == "ADDED=true" ]]
}

@test "arb add does not reapply workspace templates" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "ws-only" > "$TEST_DIR/project/.arb/templates/workspace/marker.txt"

    arb create tpl-add-nows repo-a
    # Remove the workspace template file that was seeded during create
    rm "$TEST_DIR/project/tpl-add-nows/marker.txt"

    cd "$TEST_DIR/project/tpl-add-nows"
    arb add repo-b

    # The file should NOT be re-seeded by arb add
    [ ! -f "$TEST_DIR/project/tpl-add-nows/marker.txt" ]
}

@test "template for a repo not in the workspace is silently ignored" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/nonexistent-repo"
    echo "ignored" > "$TEST_DIR/project/.arb/templates/repos/nonexistent-repo/.env"

    run arb create tpl-ignore-test repo-a
    [ "$status" -eq 0 ]
    [ ! -f "$TEST_DIR/project/tpl-ignore-test/nonexistent-repo/.env" ]
}

@test "workspace templates applied when creating workspace with zero repos" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "empty-ws" > "$TEST_DIR/project/.arb/templates/workspace/config.txt"

    arb create tpl-empty-ws
    [ -f "$TEST_DIR/project/tpl-empty-ws/config.txt" ]
    run cat "$TEST_DIR/project/tpl-empty-ws/config.txt"
    [[ "$output" == "empty-ws" ]]
}

@test "arb create reports seeded template count" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "a" > "$TEST_DIR/project/.arb/templates/workspace/ws.txt"
    echo "b" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    run arb create tpl-count-test repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"Seeded 2 template files"* ]]
}

@test "arb remove --all-ok --force produces per-workspace output" {
    arb create ws-one repo-a
    arb create ws-two repo-a
    git -C "$TEST_DIR/project/ws-one/repo-a" push -u origin ws-one >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-two/repo-a" push -u origin ws-two >/dev/null 2>&1

    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    # Should have per-workspace status tables
    [[ "$output" == *"ws-one:"* ]]
    [[ "$output" == *"ws-two:"* ]]
    [[ "$output" == *"clean"* ]]
    # Should have compact inline results during execution
    [[ "$output" == *"[ws-one] removed"* ]]
    [[ "$output" == *"[ws-two] removed"* ]]
    [[ "$output" == *"Removed 2 workspaces"* ]]
}

@test "arb remove multiple names --force shows unified plan then compact execution" {
    arb create ws-x repo-a
    arb create ws-y repo-b

    run arb remove ws-x ws-y --force
    [ "$status" -eq 0 ]
    # Unified plan: per-workspace status sections
    [[ "$output" == *"ws-x:"* ]]
    [[ "$output" == *"ws-y:"* ]]
    # Compact execution lines
    [[ "$output" == *"[ws-x] removed"* ]]
    [[ "$output" == *"[ws-y] removed"* ]]
    [[ "$output" == *"Removed 2 workspaces"* ]]
}

@test "arb remove single name --force keeps detailed output" {
    arb create ws-solo repo-a

    run arb remove ws-solo --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Removed workspace ws-solo"* ]]
}

# ── remove: template drift detection ─────────────────────────────

@test "arb remove shows template drift info for modified repo template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-drift repo-a
    # Modify the template-seeded file
    echo "DB=production" > "$TEST_DIR/project/tpl-drift/repo-a/.env"

    run arb remove tpl-drift --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Template files modified"* ]]
    [[ "$output" == *"[repo-a] .env"* ]]
}

@test "arb remove shows template drift info for modified workspace template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "WS=original" > "$TEST_DIR/project/.arb/templates/workspace/.env"

    arb create tpl-drift-ws repo-a
    echo "WS=modified" > "$TEST_DIR/project/tpl-drift-ws/.env"

    run arb remove tpl-drift-ws --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Template files modified"* ]]
    [[ "$output" == *".env"* ]]
}

@test "arb remove shows no template drift when files are unchanged" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-nodrift repo-a
    # Don't modify the file

    run arb remove tpl-nodrift --force
    [ "$status" -eq 0 ]
    [[ "$output" != *"Template files modified"* ]]
}

@test "arb remove multi-workspace shows unified plan with template drift" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-multi-a repo-a
    arb create tpl-multi-b repo-a
    echo "DB=custom" > "$TEST_DIR/project/tpl-multi-a/repo-a/.env"

    run arb remove tpl-multi-a tpl-multi-b --force
    [ "$status" -eq 0 ]
    # Should show per-workspace sections
    [[ "$output" == *"tpl-multi-a:"* ]]
    [[ "$output" == *"tpl-multi-b:"* ]]
    # Only tpl-multi-a has drift
    [[ "$output" == *"Template files modified"* ]]
    [[ "$output" == *"Removed 2 workspaces"* ]]
}

@test "arb remove multi-workspace refuses all when one is at-risk" {
    arb create at-risk-a repo-a
    arb create at-risk-b repo-a

    # Make at-risk-a dirty
    echo "uncommitted" > "$TEST_DIR/project/at-risk-a/repo-a/dirty.txt"

    run arb remove at-risk-a at-risk-b
    [ "$status" -ne 0 ]
    [[ "$output" == *"Refusing to remove"* ]]
    [[ "$output" == *"at-risk-a"* ]]
    # Both workspaces should still exist
    [ -d "$TEST_DIR/project/at-risk-a" ]
    [ -d "$TEST_DIR/project/at-risk-b" ]
}

@test "arb remove --all-ok shows template drift in status table" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "WS=original" > "$TEST_DIR/project/.arb/templates/workspace/.env"

    arb create tpl-allok repo-a
    git -C "$TEST_DIR/project/tpl-allok/repo-a" push -u origin tpl-allok >/dev/null 2>&1
    # Modify workspace-level template file (outside git repos, doesn't affect dirty status)
    echo "WS=modified" > "$TEST_DIR/project/tpl-allok/.env"

    run arb remove --all-ok --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Template files modified"* ]]
    [ ! -d "$TEST_DIR/project/tpl-allok" ]
}

@test "arb remove --force succeeds when cwd is inside the workspace being removed" {
    arb create doomed repo-a repo-b

    cd "$TEST_DIR/project/doomed"
    run arb remove doomed --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Removed workspace doomed"* ]]
    [ ! -d "$TEST_DIR/project/doomed" ]
}

@test "arb remove --yes skips confirmation for clean workspace" {
    arb create ws-yes repo-a
    git -C "$TEST_DIR/project/ws-yes/repo-a" push -u origin ws-yes >/dev/null 2>&1

    run arb remove ws-yes --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-yes" ]
    [[ "$output" == *"Removed workspace ws-yes"* ]]
}

@test "arb remove -y skips confirmation for clean workspace" {
    arb create ws-yshort repo-a
    git -C "$TEST_DIR/project/ws-yshort/repo-a" push -u origin ws-yshort >/dev/null 2>&1

    run arb remove ws-yshort -y
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-yshort" ]
}

@test "arb remove --yes still refuses at-risk workspace" {
    arb create ws-atrisk repo-a
    echo "uncommitted" > "$TEST_DIR/project/ws-atrisk/repo-a/dirty.txt"

    run arb remove ws-atrisk --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Refusing to remove"* ]]
    [ -d "$TEST_DIR/project/ws-atrisk" ]
}

@test "arb remove --force implies --yes" {
    arb create ws-fy repo-a
    echo "uncommitted" > "$TEST_DIR/project/ws-fy/repo-a/dirty.txt"

    run arb remove ws-fy --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-fy" ]
}

@test "arb remove -d shows remote deletion notice in plan" {
    arb create ws-dnotice repo-a
    git -C "$TEST_DIR/project/ws-dnotice/repo-a" push -u origin ws-dnotice >/dev/null 2>&1

    run arb remove ws-dnotice -y -d
    [ "$status" -eq 0 ]
    [[ "$output" == *"Remote branches will also be deleted"* ]]
    [ ! -d "$TEST_DIR/project/ws-dnotice" ]
    # Remote branch should be gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/ws-dnotice"
    [ "$status" -ne 0 ]
}

@test "arb remove --all-ok --yes skips confirmation" {
    arb create ws-allok-y repo-a
    git -C "$TEST_DIR/project/ws-allok-y/repo-a" push -u origin ws-allok-y >/dev/null 2>&1

    run arb remove --all-ok --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-allok-y" ]
}

@test "arb remove --all-ok -d shows remote deletion notice" {
    arb create ws-allok-d repo-a
    git -C "$TEST_DIR/project/ws-allok-d/repo-a" push -u origin ws-allok-d >/dev/null 2>&1

    run arb remove --all-ok --yes -d
    [ "$status" -eq 0 ]
    [[ "$output" == *"Remote branches will also be deleted"* ]]
    [ ! -d "$TEST_DIR/project/ws-allok-d" ]
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
    # Must NOT contain the execution summary
    [[ "$output" != *"Merged"* ]]
    # Verify the upstream commit is NOT reachable (merge didn't happen)
    run git -C "$TEST_DIR/project/my-feature/repo-a" log --oneline
    [[ "$output" != *"upstream"* ]]
}

@test "arb remove --dry-run shows status without removing" {
    arb create my-feature repo-a repo-b
    cd "$TEST_DIR/project"
    run arb remove my-feature --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Removed"* ]]
    # Verify the workspace still exists
    [ -d "$TEST_DIR/project/my-feature" ]
}

@test "arb remove --all-ok --dry-run shows workspaces without removing" {
    arb create ws-one repo-a
    git -C "$TEST_DIR/project/ws-one/repo-a" push -u origin ws-one >/dev/null 2>&1
    arb create ws-two repo-b
    git -C "$TEST_DIR/project/ws-two/repo-b" push -u origin ws-two >/dev/null 2>&1
    cd "$TEST_DIR/project"
    run arb remove --all-ok --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    # Must NOT contain the execution summary
    [[ "$output" != *"Removed"* ]]
    # Verify both workspaces still exist
    [ -d "$TEST_DIR/project/ws-one" ]
    [ -d "$TEST_DIR/project/ws-two" ]
}

