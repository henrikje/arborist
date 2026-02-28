#!/usr/bin/env bats

load test_helper/common-setup

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

@test "arb pull repo-a only fetches named repo" {
    arb create my-feature repo-a repo-b

    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1

    # Push a remote commit to repo-a
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone-a" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone-a" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull repo-a --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched 1 repo"* ]]
    [[ "$output" == *"Pulled 1 repo"* ]]
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
    [[ "$output" == *"Skipping confirmation"* ]]
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
    [[ "$output" == *"Skipping confirmation"* ]]
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

@test "arb push repo-a only fetches named repo" {
    arb create my-feature repo-a repo-b
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "change" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push repo-a --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Fetched 1 repo"* ]]
    [[ "$output" == *"Pushed 1 repo"* ]]
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

@test "arb pull skips rebased repo" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Advance main and rebase
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    # Pull should skip the rebased repo
    run arb pull --yes
    [[ "$output" == *"rebased locally"* ]]
    [[ "$output" == *"push --force"* ]]
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

@test "arb pull --rebase --merge errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb pull --rebase --merge --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot use both --rebase and --merge"* ]]
}

# ── gone remote branches ─────────────────────────────────────────

@test "arb status exits 0 for gone repos (gone is not at-risk)" {
    arb create gone-exit repo-a
    push_then_delete_remote gone-exit repo-a

    cd "$TEST_DIR/project/gone-exit"
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"gone"* ]]
    [[ "$output" == *"to push"* ]]
}

@test "arb delete treats gone repos as safe" {
    arb create gone-remove repo-a
    push_then_delete_remote gone-remove repo-a

    run arb delete gone-remove --yes --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/gone-remove" ]
}

# ── merged branch detection ──────────────────────────────────────

@test "arb push --force overrides merged skip and recreates branch" {
    arb create merged-force repo-a
    local wt="$TEST_DIR/project/merged-force/repo-a"

    # Make feature work and push
    echo "feature content" > "$wt/feature.txt"
    git -C "$wt" add feature.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/merged-force"
    arb push --yes >/dev/null 2>&1

    # Squash merge + delete
    local bare="$TEST_DIR/origin/repo-a.git"
    local tmp="$TEST_DIR/tmp-squash-force"
    git clone "$bare" "$tmp" >/dev/null 2>&1
    (cd "$tmp" && git merge --squash origin/merged-force && git commit -m "squash merge") >/dev/null 2>&1
    (cd "$tmp" && git push origin main) >/dev/null 2>&1
    rm -rf "$tmp"
    git -C "$bare" branch -D merged-force >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch --prune >/dev/null 2>&1

    cd "$TEST_DIR/project/merged-force"
    run arb push --force --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"pushed"* ]] || [[ "$output" == *"Pushed"* ]]
}

@test "arb status --json includes mergedIntoBase field" {
    arb create merged-json repo-a
    local wt="$TEST_DIR/project/merged-json/repo-a"

    # Make feature work and push
    echo "feature content" > "$wt/feature.txt"
    git -C "$wt" add feature.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/merged-json"
    arb push --yes >/dev/null 2>&1

    # Squash merge + delete
    local bare="$TEST_DIR/origin/repo-a.git"
    local tmp="$TEST_DIR/tmp-squash-json"
    git clone "$bare" "$tmp" >/dev/null 2>&1
    (cd "$tmp" && git merge --squash origin/merged-json && git commit -m "squash merge") >/dev/null 2>&1
    (cd "$tmp" && git push origin main) >/dev/null 2>&1
    rm -rf "$tmp"
    git -C "$bare" branch -D merged-json >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch --prune >/dev/null 2>&1

    cd "$TEST_DIR/project/merged-json"
    fetch_all_repos
    run arb status --no-fetch --json
    echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['repos'][0]
assert r['base']['mergedIntoBase'] == 'squash', f'expected squash, got {r[\"base\"][\"mergedIntoBase\"]}'
"
}

@test "arb status detects regular merge when remote branch is deleted" {
    arb create merge-gone repo-a
    local wt="$TEST_DIR/project/merge-gone/repo-a"

    # Make feature work and push
    echo "feature" > "$wt/feature.txt"
    git -C "$wt" add feature.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/merge-gone"
    arb push --yes >/dev/null 2>&1

    # Regular merge (not squash, --no-ff to create merge commit) + delete remote branch
    local bare="$TEST_DIR/origin/repo-a.git"
    local tmp="$TEST_DIR/tmp-merge-gone"
    git clone "$bare" "$tmp" >/dev/null 2>&1
    (cd "$tmp" && git merge --no-ff origin/merge-gone -m "merge feature" && git push origin main) >/dev/null 2>&1
    rm -rf "$tmp"
    git -C "$bare" branch -D merge-gone >/dev/null 2>&1

    cd "$TEST_DIR/project/merge-gone"
    fetch_all_repos
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"merged"* ]]
    [[ "$output" == *"gone"* ]]
}

@test "arb status detects fast-forward merge when remote branch is deleted" {
    arb create ff-gone repo-a
    local wt="$TEST_DIR/project/ff-gone/repo-a"

    # Make feature work and push
    echo "feature" > "$wt/feature.txt"
    git -C "$wt" add feature.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/ff-gone"
    arb push --yes >/dev/null 2>&1

    # Fast-forward merge (no merge commit) + delete remote branch
    local bare="$TEST_DIR/origin/repo-a.git"
    local tmp="$TEST_DIR/tmp-ff-gone"
    git clone "$bare" "$tmp" >/dev/null 2>&1
    (cd "$tmp" && git merge --ff-only origin/ff-gone && git push origin main) >/dev/null 2>&1
    rm -rf "$tmp"
    git -C "$bare" branch -D ff-gone >/dev/null 2>&1

    cd "$TEST_DIR/project/ff-gone"
    fetch_all_repos
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"merged"* ]]
    [[ "$output" == *"gone"* ]]
}

@test "arb status detects regular merge when remote branch still exists" {
    arb create merge-kept repo-a
    local wt="$TEST_DIR/project/merge-kept/repo-a"

    # Make feature work and push
    echo "feature" > "$wt/feature.txt"
    git -C "$wt" add feature.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/merge-kept"
    arb push --yes >/dev/null 2>&1

    # Regular merge (not squash, --no-ff to create merge commit), keep remote branch
    local bare="$TEST_DIR/origin/repo-a.git"
    local tmp="$TEST_DIR/tmp-merge-kept"
    git clone "$bare" "$tmp" >/dev/null 2>&1
    (cd "$tmp" && git merge --no-ff origin/merge-kept -m "merge feature" && git push origin main) >/dev/null 2>&1
    rm -rf "$tmp"

    cd "$TEST_DIR/project/merge-kept"
    fetch_all_repos
    run arb status
    [ "$status" -eq 0 ]
    [[ "$output" == *"merged"* ]]
}

# ── --verbose ────────────────────────────────────────────────────

@test "arb push --verbose --dry-run shows outgoing commits" {
    arb create my-feature repo-a
    echo "feature work" > "$TEST_DIR/project/my-feature/repo-a/feature.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add feature.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feat: push verbose test" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Outgoing to origin:"* ]]
    [[ "$output" == *"feat: push verbose test"* ]]
}

@test "arb pull --verbose --dry-run shows incoming commits" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && echo "initial" > file.txt && git add file.txt && git commit -m "initial" && git push -u origin my-feature) >/dev/null 2>&1

    # Push a remote commit
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-pull-verbose" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-pull-verbose" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "feat: pull verbose test" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --verbose --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Incoming from origin"* ]]
    [[ "$output" == *"feat: pull verbose test"* ]]
}

# ── pull merge-mode annotations ──────────────────────────────────

@test "arb pull --merge fast-forward shows merge, fast-forward" {
    arb create my-feature repo-a
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push a remote commit
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-ff-pull" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-ff-pull" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --merge --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"merge, fast-forward"* ]]
}

@test "arb pull --merge three-way shows merge, three-way when diverged" {
    arb create my-feature repo-a
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Local commit
    echo "local" > "$TEST_DIR/project/my-feature/repo-a/local.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add local.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1

    # Push a remote commit
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-3way-pull" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-3way-pull" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --merge --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"merge, three-way"* ]]
}

@test "arb pull --rebase does not show fast-forward or three-way" {
    arb create my-feature repo-a
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Push a remote commit
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-rebase-pull" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-rebase-pull" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    run arb pull --rebase --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"(rebase"* ]]
    [[ "$output" != *"fast-forward"* ]]
    [[ "$output" != *"three-way"* ]]
}

# ── push (verbose) ──────────────────────────────────────────────

@test "arb push --dry-run without --verbose does not show commits" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/feature.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add feature.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feat: should not appear" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb push --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" != *"Outgoing to"* ]]
    [[ "$output" != *"feat: should not appear"* ]]
}

# ── --where filtering ────────────────────────────────────────────

@test "arb push --where filters repos from the plan" {
    arb create my-feature repo-a repo-b
    # Make repo-a dirty (uncommitted changes)
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1
    # Make repo-b have a commit to push (unpushed)
    echo "feature" > "$TEST_DIR/project/my-feature/repo-b/feature.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add feature.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "feature" >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # --where unpushed should only show repo-b (which has a commit), not repo-a (only dirty)
    run arb push --where unpushed --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" != *"repo-a"* ]]
}

@test "arb push --where with invalid term errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb push --where bogus
    [ "$status" -ne 0 ]
    [[ "$output" == *"Unknown filter"* ]]
    [[ "$output" == *"bogus"* ]]
}

@test "arb pull --where filters repos from the plan" {
    arb create my-feature repo-a repo-b
    # Push both branches so they're tracked
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1

    # Push a remote commit to repo-a only
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone-a" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone-a" && git checkout my-feature && echo "remote" > r.txt && git add r.txt && git commit -m "remote" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # --where behind-share should only show repo-a (which has something to pull)
    run arb pull --where behind-share --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb rebase --where filters repos from the plan" {
    arb create my-feature repo-a repo-b

    # Push an upstream commit to repo-a's main branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone-a" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # Fetch first so refs are fresh
    git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" fetch >/dev/null 2>&1

    # --where behind-base should only show repo-a (which is behind main)
    run arb rebase --where behind-base --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb merge --where filters repos from the plan" {
    arb create my-feature repo-a repo-b

    # Push an upstream commit to repo-a's main branch
    git clone "$TEST_DIR/origin/repo-a.git" "$TEST_DIR/tmp-clone-a" >/dev/null 2>&1
    (cd "$TEST_DIR/tmp-clone-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" fetch >/dev/null 2>&1

    # --where behind-base should only show repo-a
    run arb merge --where behind-base --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb rebase --where with invalid term errors" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb rebase --where invalid-term
    [ "$status" -ne 0 ]
    [[ "$output" == *"Unknown filter"* ]]
}

@test "arb push positional repos + --where compose with AND logic" {
    arb create my-feature repo-a repo-b
    # Make both repos have commits to push
    echo "a" > "$TEST_DIR/project/my-feature/repo-a/a.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add a.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit a" >/dev/null 2>&1
    echo "b" > "$TEST_DIR/project/my-feature/repo-b/b.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add b.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "commit b" >/dev/null 2>&1
    # Also make repo-a dirty
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add dirty.txt >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    # positional selects repo-a only, --where dirty narrows further — repo-a matches both
    run arb push repo-a --where dirty --dry-run --no-fetch
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}
