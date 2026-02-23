setup() {
    TEST_DIR="$(mktemp -d)"
    TEST_DIR="$(cd "$TEST_DIR" && pwd -P)"
    export PATH="$BATS_TEST_DIRNAME/../../dist:$PATH"

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

setup_local_repo() {
    git init "$TEST_DIR/project/.arb/repos/local-lib" >/dev/null 2>&1
    (cd "$TEST_DIR/project/.arb/repos/local-lib" && git commit --allow-empty -m "init") >/dev/null 2>&1
}

delete_workspace_config() {
    local name="$1"
    rm -f "$TEST_DIR/project/$name/.arbws/config"
}

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

fetch_all_repos() {
    for repo_dir in "$TEST_DIR/project/.arb/repos"/*/; do
        [ -d "$repo_dir/.git" ] || continue
        git -C "$repo_dir" fetch --prune 2>/dev/null || true
    done
}
