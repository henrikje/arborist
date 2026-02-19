#!/usr/bin/env bats

load test_helper/common-setup

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

@test "arb status -v shows file details (short alias for --verbose)" {
    arb create my-feature repo-a
    echo "new" > "$TEST_DIR/project/my-feature/repo-a/newfile.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb status -v
    [[ "$output" == *"Untracked files:"* ]]
    [[ "$output" == *"newfile.txt"* ]]
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
    [[ "$output" == *"Ahead of origin/main:"* ]]
    [[ "$output" == *"ahead commit"* ]]
}

@test "arb status --verbose shows behind base section" {
    arb create my-feature repo-a

    # Add a commit to origin's default branch so we're behind
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream change" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --verbose
    [[ "$output" == *"Behind origin/main:"* ]]
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

@test "arb status --json includes lastCommit" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status --json
    echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'lastCommit' in d
assert isinstance(d['lastCommit'], str), 'lastCommit should be an ISO date string'
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
    [[ "$output" == *"LAST COMMIT"* ]]
    [[ "$output" == *"BASE"* ]]
    [[ "$output" == *"SHARE"* ]]
    [[ "$output" == *"LOCAL"* ]]
}

@test "arb status shows relative time in LAST COMMIT column" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && \
     GIT_AUTHOR_DATE="$(date -v-2d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '2 days ago' +%Y-%m-%dT%H:%M:%S)" \
     git commit --allow-empty -m "old commit") >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"2 days"* ]]
}

@test "arb status shows weeks for old commits" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && \
     GIT_AUTHOR_DATE="$(date -v-14d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '14 days ago' +%Y-%m-%dT%H:%M:%S)" \
     git commit --allow-empty -m "old commit") >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"2 weeks"* ]]
}

@test "arb status shows years for very old commits" {
    arb create my-feature repo-a
    (cd "$TEST_DIR/project/my-feature/repo-a" && \
     GIT_AUTHOR_DATE="$(date -v-400d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '400 days ago' +%Y-%m-%dT%H:%M:%S)" \
     git commit --allow-empty -m "ancient commit") >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    [[ "$output" == *"1 year"* ]]
}

@test "arb status LAST COMMIT column appears after BRANCH" {
    arb create my-feature repo-a
    cd "$TEST_DIR/project/my-feature"
    run arb status
    header=$(echo "$output" | head -1)
    branch_pos=$(echo "$header" | grep -bo "BRANCH" | head -1 | cut -d: -f1)
    commit_pos=$(echo "$header" | grep -bo "LAST COMMIT" | head -1 | cut -d: -f1)
    base_pos=$(echo "$header" | grep -bo "BASE" | head -1 | cut -d: -f1)
    # LAST COMMIT should be after BRANCH and before BASE
    [ "$commit_pos" -gt "$branch_pos" ]
    [ "$commit_pos" -lt "$base_pos" ]
}

@test "arb status LAST COMMIT right-aligns numbers across repos" {
    arb create my-feature repo-a repo-b
    # repo-a: 3 days ago (single-digit number)
    (cd "$TEST_DIR/project/my-feature/repo-a" && \
     GIT_AUTHOR_DATE="$(date -v-3d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '3 days ago' +%Y-%m-%dT%H:%M:%S)" \
     git commit --allow-empty -m "recent") >/dev/null 2>&1
    # repo-b: ~10 months ago (double-digit number)
    (cd "$TEST_DIR/project/my-feature/repo-b" && \
     GIT_AUTHOR_DATE="$(date -v-300d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d '300 days ago' +%Y-%m-%dT%H:%M:%S)" \
     git commit --allow-empty -m "older") >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb status
    # Single-digit "3" should be padded to align with double-digit "10"
    # Extract the data lines (skip header)
    repo_a_line=$(echo "$output" | grep "repo-a")
    repo_b_line=$(echo "$output" | grep "repo-b")
    # Find the position of the unit text — both "days" and "months" should start at the same column
    days_pos=$(echo "$repo_a_line" | grep -bo "days" | head -1 | cut -d: -f1)
    months_pos=$(echo "$repo_b_line" | grep -bo "months" | head -1 | cut -d: -f1)
    [ "$days_pos" -eq "$months_pos" ]
}

@test "arb status --where at-risk shows only at-risk repos" {
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
    run arb status --where at-risk
    [[ "$output" == *"(no repos)"* ]]
}

@test "arb status --where at-risk shows dirty repos" {
    arb create my-feature repo-a repo-b
    # Make repo-a dirty (at-risk), push repo-b so it's clean and pushed (not at-risk)
    echo "dirty" > "$TEST_DIR/project/my-feature/repo-a/dirty.txt"
    echo "change" > "$TEST_DIR/project/my-feature/repo-b/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-b" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-b" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --where at-risk
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

# ── status JSON & edge cases ──────────────────────────────────────

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


# ── missing config recovery ──────────────────────────────────────

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


# ── isDiverged flag ──────────────────────────────────────────────

@test "arb status --where diverged shows only diverged repos" {
    arb create my-feature repo-a repo-b

    # Make repo-a diverged: local commit + upstream commit
    echo "local" > "$TEST_DIR/project/my-feature/repo-a/local.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add local.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # repo-b stays equal (not diverged)

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --where diverged
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb status --where diverged excludes behind-only repos" {
    arb create my-feature repo-a

    # Make repo-a only behind (not diverged)
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --where diverged
    # repo-a is behind-only, not diverged — should not match
    [[ "$output" != *"repo-a"* ]]
}


# ── status conflict prediction ───────────────────────────────────

@test "arb status shows diverged with overlapping changes (conflict path)" {
    arb create my-feature repo-a

    # Create a shared file on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull the shared file into the feature branch
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    arb rebase --yes >/dev/null 2>&1

    # Conflicting change on feature branch
    echo "feature version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add shared.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Conflicting change on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    arb fetch >/dev/null 2>&1
    run arb status
    [ "$status" -eq 1 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"1 ahead"* ]]
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status shows diverged with non-overlapping changes (clean path)" {
    arb create my-feature repo-a

    # Local commit on feature branch (different file)
    echo "local" > "$TEST_DIR/project/my-feature/repo-a/local.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add local.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "local" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Upstream commit on main (different file)
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status
    [ "$status" -eq 1 ]
    [[ "$output" == *"1 ahead"* ]]
    [[ "$output" == *"1 behind"* ]]
}

@test "arb status with mixed diverged and non-diverged repos" {
    arb create my-feature repo-a repo-b

    # Create a shared file on main for repo-a
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull into feature branch
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    arb rebase --yes >/dev/null 2>&1

    # Conflicting change on feature branch for repo-a
    echo "feature version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add shared.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Conflicting change on main for repo-a
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    # repo-b stays equal (no changes)

    arb fetch >/dev/null 2>&1
    run arb status
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" == *"repo-b"* ]]
    [[ "$output" == *"equal"* ]]
}

# ── status rebased detection ──────────────────────────────────────

@test "arb status shows rebased instead of push/pull after rebase" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Advance main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Rebase feature onto advanced main
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    arb fetch >/dev/null 2>&1
    run arb status
    # Should show "rebased" instead of misleading "to push, to pull"
    [[ "$output" == *"rebased"* ]]
    [[ "$output" != *"to pull"* ]]
}

@test "arb status -v shows (rebased) annotations on commits" {
    arb create my-feature repo-a
    echo "first" > "$TEST_DIR/project/my-feature/repo-a/first.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add first.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "first feature" >/dev/null 2>&1
    echo "second" > "$TEST_DIR/project/my-feature/repo-a/second.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add second.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "second feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Advance main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1

    # Rebase
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    arb fetch >/dev/null 2>&1
    run arb status -v
    # Verbose output should annotate rebased commits
    [[ "$output" == *"(rebased)"* ]]
    [[ "$output" == *"first feature"* ]]
    [[ "$output" == *"second feature"* ]]
}

@test "arb status --json includes rebased field in share" {
    arb create my-feature repo-a
    echo "feature" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Advance main and rebase
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "upstream" > upstream.txt && git add upstream.txt && git commit -m "upstream" && git push) >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb rebase --yes >/dev/null 2>&1

    arb fetch >/dev/null 2>&1
    run arb status --json
    echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['repos'][0]
assert 'rebased' in r['share'], 'share should have rebased field'
assert r['share']['rebased'] == 1, f'expected rebased=1, got {r[\"share\"][\"rebased\"]}'
"
}

@test "arb status --json rebased is null when not diverged" {
    arb create my-feature repo-a
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/f.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    run arb status --json
    echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['repos'][0]
assert r['share']['rebased'] is None, f'expected rebased=null, got {r[\"share\"][\"rebased\"]}'
"
}

@test "arb status --json unaffected by conflict prediction" {
    arb create my-feature repo-a

    # Create a shared file on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "original" > shared.txt && git add shared.txt && git commit -m "add shared" && git push) >/dev/null 2>&1

    # Pull into feature branch
    cd "$TEST_DIR/project/my-feature"
    arb fetch >/dev/null 2>&1
    arb rebase --yes >/dev/null 2>&1

    # Conflicting change on feature branch
    echo "feature version" > "$TEST_DIR/project/my-feature/repo-a/shared.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add shared.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "feature change" >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" push -u origin my-feature >/dev/null 2>&1

    # Conflicting change on main
    (cd "$TEST_DIR/project/.arb/repos/repo-a" && echo "main version" > shared.txt && git add shared.txt && git commit -m "main change" && git push) >/dev/null 2>&1

    arb fetch >/dev/null 2>&1
    run arb status --json
    [ "$status" -eq 1 ]
    echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['repos'][0]
assert r['base']['ahead'] == 1, f'expected ahead=1, got {r[\"base\"][\"ahead\"]}'
assert r['base']['behind'] == 1, f'expected behind=1, got {r[\"base\"][\"behind\"]}'
"
}

@test "arb status -v shows merge strategy for merged branch" {
    arb create merged-verbose repo-a
    local wt="$TEST_DIR/project/merged-verbose/repo-a"

    # Make feature work and push
    echo "feature content" > "$wt/feature.txt"
    git -C "$wt" add feature.txt >/dev/null 2>&1
    git -C "$wt" commit -m "feature work" >/dev/null 2>&1
    cd "$TEST_DIR/project/merged-verbose"
    arb push --yes >/dev/null 2>&1

    # Squash merge
    local bare="$TEST_DIR/origin/repo-a.git"
    local tmp="$TEST_DIR/tmp-verbose"
    git clone "$bare" "$tmp" >/dev/null 2>&1
    (cd "$tmp" && git merge --squash origin/merged-verbose && git commit -m "squash merge") >/dev/null 2>&1
    (cd "$tmp" && git push origin main) >/dev/null 2>&1
    rm -rf "$tmp"
    git -C "$bare" branch -D merged-verbose >/dev/null 2>&1
    git -C "$TEST_DIR/project/.arb/repos/repo-a" fetch --prune >/dev/null 2>&1

    cd "$TEST_DIR/project/merged-verbose"
    arb fetch >/dev/null 2>&1
    run arb status -v
    [[ "$output" == *"merged (gone)"* ]]
    [[ "$output" == *"Branch merged into"* ]]
    [[ "$output" == *"(squash)"* ]]
}

