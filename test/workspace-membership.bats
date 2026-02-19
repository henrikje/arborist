#!/usr/bin/env bats

load test_helper/common-setup

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

@test "arb create outputs workspace path on stdout" {
    run bash -c 'arb create foo repo-a 2>/dev/null'
    [ "$output" = "$TEST_DIR/project/foo" ]
}

@test "arb create path output is clean when stdout is captured (shell wrapper pattern)" {
    _arb_dir="$(arb create capture-test repo-a 2>/dev/null)"
    [ "$_arb_dir" = "$TEST_DIR/project/capture-test" ]
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
    run arb -C "$TEST_DIR/project/my-feature" status
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


# ── remove --all-safe ──────────────────────────────────────────────

@test "arb remove --all-safe removes safe workspaces, keeps dirty" {
    arb create ws-clean repo-a
    arb create ws-dirty repo-a

    # Push ws-clean so it's "safe"
    git -C "$TEST_DIR/project/ws-clean/repo-a" push -u origin ws-clean >/dev/null 2>&1

    # Push ws-dirty then dirty it up
    git -C "$TEST_DIR/project/ws-dirty/repo-a" push -u origin ws-dirty >/dev/null 2>&1
    echo "uncommitted" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"

    run arb remove --all-safe --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-clean" ]
    [ -d "$TEST_DIR/project/ws-dirty" ]
}

@test "arb remove --all-safe skips current workspace" {
    arb create ws-inside repo-a
    git -C "$TEST_DIR/project/ws-inside/repo-a" push -u origin ws-inside >/dev/null 2>&1

    cd "$TEST_DIR/project/ws-inside"
    run arb remove --all-safe --force
    [ "$status" -eq 0 ]
    [ -d "$TEST_DIR/project/ws-inside" ]
}

@test "arb remove --all-safe with no safe workspaces exits cleanly" {
    arb create ws-dirty repo-a
    git -C "$TEST_DIR/project/ws-dirty/repo-a" push -u origin ws-dirty >/dev/null 2>&1
    echo "uncommitted" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"

    run arb remove --all-safe --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"No workspaces with safe status"* ]]
    [ -d "$TEST_DIR/project/ws-dirty" ]
}

@test "arb remove --all-safe with positional args errors" {
    run arb remove --all-safe ws-a
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot combine --all-safe with workspace names."* ]]
}

@test "arb remove --all-safe --force skips confirmation" {
    arb create ws-ok repo-a
    git -C "$TEST_DIR/project/ws-ok/repo-a" push -u origin ws-ok >/dev/null 2>&1

    run arb remove --all-safe --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-ok" ]
}

@test "arb remove --all-safe skips config-missing workspaces" {
    arb create ws-broken repo-a
    git -C "$TEST_DIR/project/ws-broken/repo-a" push -u origin ws-broken >/dev/null 2>&1
    # Remove config to simulate config-missing state
    rm "$TEST_DIR/project/ws-broken/.arbws/config"

    run arb remove --all-safe --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"No workspaces with safe status"* ]]
    [ -d "$TEST_DIR/project/ws-broken" ]
}

@test "arb remove --all-safe --delete-remote composes correctly" {
    arb create ws-rd repo-a
    git -C "$TEST_DIR/project/ws-rd/repo-a" push -u origin ws-rd >/dev/null 2>&1

    run arb remove --all-safe --force --delete-remote
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-rd" ]
    # Remote branch should be gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/ws-rd"
    [ "$status" -ne 0 ]
}

@test "arb remove --all-safe includes workspaces that are behind base" {
    arb create ws-behind repo-a
    git -C "$TEST_DIR/project/ws-behind/repo-a" push -u origin ws-behind >/dev/null 2>&1

    # Advance the remote's default branch so ws-behind is behind base
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "advance" > advance.txt && git add advance.txt && git commit -m "advance main" && git push) >/dev/null 2>&1

    # Fetch so the workspace sees the new remote state
    git -C "$TEST_DIR/project/ws-behind/repo-a" fetch origin >/dev/null 2>&1

    run arb remove --all-safe --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-behind" ]
}

