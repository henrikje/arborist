#!/usr/bin/env bats

load test_helper/common-setup

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
    [[ "$output" == *"Fetched"* ]]
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
    [[ "$output" != *"Fetched"* ]]
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


# ── pull --rebase / --merge ──────────────────────────────────────

@test "arb pull defaults to merge mode in plan and result" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"to pull (merge"* ]]
    [[ "$output" == *"pulled"*"(merge)"* ]]
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
    [[ "$output" == *"to pull (rebase"* ]]
    [[ "$output" == *"pulled"*"(rebase)"* ]]
}

@test "arb pull --rebase forces rebase mode" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "change" > file.txt && git add file.txt && git commit -m "change" && git push -u origin my-feature) >/dev/null 2>&1

    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote commit" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --rebase --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"to pull (rebase"* ]]
    [[ "$output" == *"pulled"*"(rebase)"* ]]
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
    [[ "$output" == *"to pull (merge"* ]]
    [[ "$output" == *"pulled"*"(merge)"* ]]
}

@test "arb pull --rebase --merge errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb pull --rebase --merge --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot use both --rebase and --merge"* ]]
}


# ── gone remote branches ─────────────────────────────────────────

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

