#!/usr/bin/env bats

load test_helper/common-setup

# ── JSON Schema conformance ──────────────────────────────────────
# Each test validates that --json output conforms to the --schema
# for that command, using ajv (draft-2020-12).

validate() {
    local schema_file="$TEST_DIR/schema.json"
    local data_file="$TEST_DIR/data.json"
    echo "$1" > "$schema_file"
    echo "$2" > "$data_file"
    bun run "$BATS_TEST_DIRNAME/../../scripts/validate-json-schema.ts" "$schema_file" "$data_file"
}

@test "status --json conforms to status --schema" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"

    schema="$(arb status --schema 2>/dev/null)"
    data="$(arb status --no-fetch --json 2>/dev/null)"
    run validate "$schema" "$data"
    [ "$status" -eq 0 ]
}

@test "log --json conforms to log --schema" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "test commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"

    schema="$(arb log --schema 2>/dev/null)"
    data="$(arb log --no-fetch --json 2>/dev/null)"
    run validate "$schema" "$data"
    [ "$status" -eq 0 ]
}

@test "diff --json conforms to diff --schema" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    echo "change" > "$TEST_DIR/project/my-feature/repo-a/file.txt"
    git -C "$TEST_DIR/project/my-feature/repo-a" add file.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/my-feature/repo-a" commit -m "test commit" >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"

    schema="$(arb diff --schema 2>/dev/null)"
    data="$(arb diff --no-fetch --json 2>/dev/null)"
    run validate "$schema" "$data"
    [ "$status" -eq 0 ]
}

@test "branch --json conforms to branch --schema" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"

    schema="$(arb branch --schema 2>/dev/null)"
    data="$(arb branch --no-fetch --json 2>/dev/null)"
    run validate "$schema" "$data"
    [ "$status" -eq 0 ]
}

@test "list --json conforms to list --schema" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1

    schema="$(arb list --schema 2>/dev/null)"
    data="$(arb list --no-fetch --json 2>/dev/null)"
    run validate "$schema" "$data"
    [ "$status" -eq 0 ]
}

@test "repo list --json conforms to repo list --schema" {
    schema="$(arb repo list --schema 2>/dev/null)"
    data="$(arb repo list --json 2>/dev/null)"
    run validate "$schema" "$data"
    [ "$status" -eq 0 ]
}
