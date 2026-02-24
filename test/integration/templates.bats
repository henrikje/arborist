#!/usr/bin/env bats

load test_helper/common-setup

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
    arb attach repo-b

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

@test "arb attach applies repo templates for newly added repos" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-b"
    echo "ADDED=true" > "$TEST_DIR/project/.arb/templates/repos/repo-b/.env"

    arb create tpl-add-test repo-a
    cd "$TEST_DIR/project/tpl-add-test"
    arb attach repo-b

    [ -f "$TEST_DIR/project/tpl-add-test/repo-b/.env" ]
    run cat "$TEST_DIR/project/tpl-add-test/repo-b/.env"
    [[ "$output" == "ADDED=true" ]]
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

@test "arb delete --all-safe --force produces per-workspace output" {
    arb create ws-one repo-a
    arb create ws-two repo-a
    git -C "$TEST_DIR/project/ws-one/repo-a" push -u origin ws-one >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-two/repo-a" push -u origin ws-two >/dev/null 2>&1

    run arb delete --all-safe --force
    [ "$status" -eq 0 ]
    # Should have columnar table with workspace names
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    [[ "$output" == *"no issues"* ]]
    # Should have compact inline results during execution
    [[ "$output" == *"[ws-one] deleted"* ]]
    [[ "$output" == *"[ws-two] deleted"* ]]
    [[ "$output" == *"Deleted 2 workspaces"* ]]
}

@test "arb delete multiple names --force shows unified plan then compact execution" {
    arb create ws-x repo-a
    arb create ws-y repo-b

    run arb delete ws-x ws-y --force
    [ "$status" -eq 0 ]
    # Unified plan: columnar table with workspace names
    [[ "$output" == *"ws-x"* ]]
    [[ "$output" == *"ws-y"* ]]
    # Compact execution lines
    [[ "$output" == *"[ws-x] deleted"* ]]
    [[ "$output" == *"[ws-y] deleted"* ]]
    [[ "$output" == *"Deleted 2 workspaces"* ]]
}

@test "arb delete single name --force keeps detailed output" {
    arb create ws-solo repo-a

    run arb delete ws-solo --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"[ws-solo] deleted"* ]]
    [[ "$output" == *"Deleted 1 workspace"* ]]
}

# ── remove: template drift detection ─────────────────────────────

@test "arb delete shows template drift info for modified repo template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-drift repo-a
    # Modify the template-seeded file
    echo "DB=production" > "$TEST_DIR/project/tpl-drift/repo-a/.env"

    run arb delete tpl-drift --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Template files modified"* ]]
    [[ "$output" == *"[repo-a] .env"* ]]
}

@test "arb delete shows template drift info for modified workspace template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "WS=original" > "$TEST_DIR/project/.arb/templates/workspace/.env"

    arb create tpl-drift-ws repo-a
    echo "WS=modified" > "$TEST_DIR/project/tpl-drift-ws/.env"

    run arb delete tpl-drift-ws --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Template files modified"* ]]
    [[ "$output" == *".env"* ]]
}

@test "arb delete shows no template drift when files are unchanged" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-nodrift repo-a
    # Don't modify the file

    run arb delete tpl-nodrift --force
    [ "$status" -eq 0 ]
    [[ "$output" != *"Template files modified"* ]]
}

@test "arb delete multi-workspace shows unified plan with template drift" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"

    arb create tpl-multi-a repo-a
    arb create tpl-multi-b repo-a
    echo "DB=custom" > "$TEST_DIR/project/tpl-multi-a/repo-a/.env"

    run arb delete tpl-multi-a tpl-multi-b --force
    [ "$status" -eq 0 ]
    # Should show columnar table with workspace names
    [[ "$output" == *"tpl-multi-a"* ]]
    [[ "$output" == *"tpl-multi-b"* ]]
    # Only tpl-multi-a has drift
    [[ "$output" == *"Template files modified"* ]]
    [[ "$output" == *"Deleted 2 workspaces"* ]]
}

@test "arb delete multi-workspace refuses all when one is at-risk" {
    arb create at-risk-a repo-a
    arb create at-risk-b repo-a

    # Make at-risk-a dirty
    echo "uncommitted" > "$TEST_DIR/project/at-risk-a/repo-a/dirty.txt"

    run arb delete at-risk-a at-risk-b
    [ "$status" -ne 0 ]
    [[ "$output" == *"Refusing to delete"* ]]
    [[ "$output" == *"at-risk-a"* ]]
    # Both workspaces should still exist
    [ -d "$TEST_DIR/project/at-risk-a" ]
    [ -d "$TEST_DIR/project/at-risk-b" ]
}

@test "arb delete --all-safe shows template drift in status table" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "WS=original" > "$TEST_DIR/project/.arb/templates/workspace/.env"

    arb create tpl-allok repo-a
    git -C "$TEST_DIR/project/tpl-allok/repo-a" push -u origin tpl-allok >/dev/null 2>&1
    # Modify workspace-level template file (outside git repos, doesn't affect dirty status)
    echo "WS=modified" > "$TEST_DIR/project/tpl-allok/.env"

    run arb delete --all-safe --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Template files modified"* ]]
    [ ! -d "$TEST_DIR/project/tpl-allok" ]
}

@test "arb delete --force succeeds when cwd is inside the workspace being removed" {
    arb create doomed repo-a repo-b

    cd "$TEST_DIR/project/doomed"
    run arb delete doomed --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Deleted 1 workspace"* ]]
    [ ! -d "$TEST_DIR/project/doomed" ]
}

@test "arb delete --yes skips confirmation for clean workspace" {
    arb create ws-yes repo-a
    git -C "$TEST_DIR/project/ws-yes/repo-a" push -u origin ws-yes >/dev/null 2>&1

    run arb delete ws-yes --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-yes" ]
    [[ "$output" == *"Deleted 1 workspace"* ]]
    [[ "$output" == *"Skipping confirmation"* ]]
}

@test "arb delete -y skips confirmation for clean workspace" {
    arb create ws-yshort repo-a
    git -C "$TEST_DIR/project/ws-yshort/repo-a" push -u origin ws-yshort >/dev/null 2>&1

    run arb delete ws-yshort -y
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-yshort" ]
}

@test "arb delete --yes still refuses at-risk workspace" {
    arb create ws-atrisk repo-a
    echo "uncommitted" > "$TEST_DIR/project/ws-atrisk/repo-a/dirty.txt"

    run arb delete ws-atrisk --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Refusing to delete"* ]]
    [ -d "$TEST_DIR/project/ws-atrisk" ]
}

@test "arb delete --force implies --yes" {
    arb create ws-fy repo-a
    echo "uncommitted" > "$TEST_DIR/project/ws-fy/repo-a/dirty.txt"

    run arb delete ws-fy --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-fy" ]
    [[ "$output" == *"Skipping confirmation"* ]]
}

@test "arb delete -r shows remote deletion notice in plan" {
    arb create ws-dnotice repo-a
    git -C "$TEST_DIR/project/ws-dnotice/repo-a" push -u origin ws-dnotice >/dev/null 2>&1

    run arb delete ws-dnotice -y -r
    [ "$status" -eq 0 ]
    [[ "$output" == *"Remote branches will also be deleted"* ]]
    [ ! -d "$TEST_DIR/project/ws-dnotice" ]
    # Remote branch should be gone
    run git -C "$TEST_DIR/project/.arb/repos/repo-a" show-ref --verify "refs/remotes/origin/ws-dnotice"
    [ "$status" -ne 0 ]
}

@test "arb delete --all-safe --yes skips confirmation" {
    arb create ws-allok-y repo-a
    git -C "$TEST_DIR/project/ws-allok-y/repo-a" push -u origin ws-allok-y >/dev/null 2>&1

    run arb delete --all-safe --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-allok-y" ]
    [[ "$output" == *"Skipping confirmation"* ]]
}

@test "arb delete --all-safe -r shows remote deletion notice" {
    arb create ws-allok-d repo-a
    git -C "$TEST_DIR/project/ws-allok-d/repo-a" push -u origin ws-allok-d >/dev/null 2>&1

    run arb delete --all-safe --yes -r
    [ "$status" -eq 0 ]
    [[ "$output" == *"Remote branches will also be deleted"* ]]
    [ ! -d "$TEST_DIR/project/ws-allok-d" ]
}


# ── template ─────────────────────────────────────────────────────

@test "arb template list shows no templates when none defined" {
    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"No templates defined"* ]]
}

@test "arb template add captures a workspace file as template" {
    arb create my-feature repo-a >/dev/null 2>&1
    echo "SECRET=abc" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .env --workspace
    [ "$status" -eq 0 ]
    [[ "$output" == *"Added template"* ]]
    [ -f "$TEST_DIR/project/.arb/templates/workspace/.env" ]
}

@test "arb template add captures a repo file as template" {
    arb create my-feature repo-a >/dev/null 2>&1
    echo "DB=localhost" > "$TEST_DIR/project/my-feature/repo-a/.env"
    cd "$TEST_DIR/project/my-feature/repo-a"
    run arb template add .env
    [ "$status" -eq 0 ]
    [[ "$output" == *"Added template"* ]]
    [[ "$output" == *"repo: repo-a"* ]]
    [ -f "$TEST_DIR/project/.arb/templates/repos/repo-a/.env" ]
}

@test "arb template add with --repo overrides scope detection" {
    arb create my-feature repo-a >/dev/null 2>&1
    echo "DB=localhost" > "$TEST_DIR/project/my-feature/repo-a/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template add repo-a/.env --repo repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"Added template"* ]]
    [ -f "$TEST_DIR/project/.arb/templates/repos/repo-a/.env" ]
}

@test "arb template add refuses overwrite without --force" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "OLD" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "NEW" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .env --workspace
    [ "$status" -ne 0 ]
    [[ "$output" == *"already exists"* ]]
}

@test "arb template add --force overwrites existing template" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "OLD" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "NEW" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .env --workspace --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Updated template"* ]]
    [ "$(cat "$TEST_DIR/project/.arb/templates/workspace/.env")" = "NEW" ]
}

@test "arb template add succeeds silently when content is identical" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "SAME" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "SAME" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .env --workspace
    [ "$status" -eq 0 ]
    [[ "$output" == *"already up to date"* ]]
}

@test "arb template remove deletes a template file" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "DB=localhost" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature/repo-a"
    run arb template remove .env
    [ "$status" -eq 0 ]
    [[ "$output" == *"Removed template"* ]]
    [ ! -f "$TEST_DIR/project/.arb/templates/repos/repo-a/.env" ]
}

@test "arb template remove errors for nonexistent template" {
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb template remove nonexistent.txt --workspace
    [ "$status" -ne 0 ]
    [[ "$output" == *"does not exist"* ]]
}

@test "arb template list shows workspace and repo templates" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "WS" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "REPO" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"
    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"[workspace]"* ]]
    [[ "$output" == *"[repo-a]"* ]]
    [[ "$output" == *".env"* ]]
}

@test "arb template list shows modified annotation inside workspace" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "ORIGINAL" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    arb create my-feature repo-a >/dev/null 2>&1
    echo "MODIFIED" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"modified"* ]]
}

@test "arb template diff shows no changes when templates match" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "SAME" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    arb create my-feature repo-a >/dev/null 2>&1
    echo "SAME" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"No changes"* ]]
}

@test "arb template diff exits 1 when drift is found" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "ORIGINAL" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    arb create my-feature repo-a >/dev/null 2>&1
    echo "MODIFIED" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template diff
    [ "$status" -eq 1 ]
    [[ "$output" == *"ORIGINAL"* ]]
    [[ "$output" == *"MODIFIED"* ]]
}

@test "arb template diff filters by file path" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "A" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "B" > "$TEST_DIR/project/.arb/templates/workspace/.config"
    arb create my-feature repo-a >/dev/null 2>&1
    echo "A-modified" > "$TEST_DIR/project/my-feature/.env"
    echo "B-modified" > "$TEST_DIR/project/my-feature/.config"
    cd "$TEST_DIR/project/my-feature"
    run arb template diff .env
    [ "$status" -eq 1 ]
    [[ "$output" == *".env"* ]]
    [[ "$output" != *".config"* ]]
}

@test "arb template diff filters by --repo" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-b"
    echo "A" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"
    echo "B" > "$TEST_DIR/project/.arb/templates/repos/repo-b/.env"
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    echo "A-modified" > "$TEST_DIR/project/my-feature/repo-a/.env"
    echo "B-modified" > "$TEST_DIR/project/my-feature/repo-b/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template diff --repo repo-a
    [ "$status" -eq 1 ]
    [[ "$output" == *"repo-a"* ]]
    [[ "$output" != *"repo-b"* ]]
}

@test "arb list --where at-risk filters workspaces" {
    arb create ws-dirty repo-a
    arb create ws-clean repo-a
    echo "dirty" > "$TEST_DIR/project/ws-dirty/repo-a/dirty.txt"
    echo "change" > "$TEST_DIR/project/ws-clean/repo-a/f.txt"
    git -C "$TEST_DIR/project/ws-clean/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-clean/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-clean/repo-a" push -u origin ws-clean >/dev/null 2>&1
    cd "$TEST_DIR/project"
    run arb list --where at-risk
    [[ "$output" == *"ws-dirty"* ]]
    [[ "$output" != *"ws-clean"* ]]
}

@test "arb delete --all-safe --where gone narrows to safe-and-gone" {
    arb create ws-gone repo-a
    arb create ws-safe repo-a
    # Make ws-gone have a gone remote (push then delete remote branch)
    echo "change" > "$TEST_DIR/project/ws-gone/repo-a/f.txt"
    git -C "$TEST_DIR/project/ws-gone/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-gone/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-gone/repo-a" push -u origin ws-gone >/dev/null 2>&1
    git -C "$TEST_DIR/origin/repo-a.git" branch -D ws-gone >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-gone/repo-a" fetch --prune >/dev/null 2>&1
    # Push ws-safe (safe but not gone)
    echo "change" > "$TEST_DIR/project/ws-safe/repo-a/f.txt"
    git -C "$TEST_DIR/project/ws-safe/repo-a" add f.txt >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-safe/repo-a" commit -m "commit" >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-safe/repo-a" push -u origin ws-safe >/dev/null 2>&1
    cd "$TEST_DIR/project"
    run arb delete --all-safe --where gone --force
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-gone" ]
    [ -d "$TEST_DIR/project/ws-safe" ]
}

@test "arb template apply seeds missing files" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Set up templates AFTER create so they haven't been seeded yet
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "SEEDED" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template apply
    [ "$status" -eq 0 ]
    [[ "$output" == *"Seeded"* ]]
    [ "$(cat "$TEST_DIR/project/my-feature/.env")" = "SEEDED" ]
}

@test "arb template apply skips existing files" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "TEMPLATE" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    arb create my-feature repo-a >/dev/null 2>&1
    echo "CUSTOM" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template apply
    [ "$status" -eq 0 ]
    [[ "$output" == *"already present"* ]]
    [ "$(cat "$TEST_DIR/project/my-feature/.env")" = "CUSTOM" ]
}

@test "arb template apply --force resets drifted files" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "TEMPLATE" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    arb create my-feature repo-a >/dev/null 2>&1
    echo "DRIFTED" > "$TEST_DIR/project/my-feature/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template apply --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"reset"* ]]
    [ "$(cat "$TEST_DIR/project/my-feature/.env")" = "TEMPLATE" ]
}

@test "arb template apply --repo limits to specific repo" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Set up templates AFTER create so they haven't been seeded yet
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "WS" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "REPO" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template apply --repo repo-a
    [ "$status" -eq 0 ]
    # Repo template seeded
    [ -f "$TEST_DIR/project/my-feature/repo-a/.env" ]
    # Workspace template NOT seeded (--repo limits scope)
    [ ! -f "$TEST_DIR/project/my-feature/.env" ]
}

@test "arb template apply --workspace limits to workspace scope" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Set up templates AFTER create so they haven't been seeded yet
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "WS" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "REPO" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template apply --workspace
    [ "$status" -eq 0 ]
    # Workspace template seeded
    [ -f "$TEST_DIR/project/my-feature/.env" ]
    # Repo template NOT seeded (--workspace limits scope)
    [ ! -f "$TEST_DIR/project/my-feature/repo-a/.env" ]
}

@test "arb template apply filters by file path" {
    arb create my-feature repo-a >/dev/null 2>&1
    # Set up templates AFTER create so they haven't been seeded yet
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "A" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "B" > "$TEST_DIR/project/.arb/templates/workspace/.config"
    cd "$TEST_DIR/project/my-feature"
    run arb template apply .env
    [ "$status" -eq 0 ]
    [ -f "$TEST_DIR/project/my-feature/.env" ]
    [ ! -f "$TEST_DIR/project/my-feature/.config" ]
}

@test "arb template --help shows subcommands" {
    run arb template --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"add"* ]]
    [[ "$output" == *"remove"* ]]
    [[ "$output" == *"list"* ]]
    [[ "$output" == *"diff"* ]]
    [[ "$output" == *"apply"* ]]
}

@test "arb template add with multiple --repo flags" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    echo "DB=localhost" > "$TEST_DIR/project/my-feature/repo-a/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template add repo-a/.env --repo repo-a --repo repo-b
    [ "$status" -eq 0 ]
    [ -f "$TEST_DIR/project/.arb/templates/repos/repo-a/.env" ]
    [ -f "$TEST_DIR/project/.arb/templates/repos/repo-b/.env" ]
}

@test "arb template add with multiple --repo continues past conflict" {
    arb create my-feature repo-a repo-b >/dev/null 2>&1
    # Pre-create a conflicting template for repo-a only
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    echo "OLD" > "$TEST_DIR/project/.arb/templates/repos/repo-a/.env"
    echo "NEW" > "$TEST_DIR/project/my-feature/repo-a/.env"
    cd "$TEST_DIR/project/my-feature"
    run arb template add repo-a/.env --repo repo-a --repo repo-b
    # Should fail (conflict on repo-a) but still add repo-b
    [ "$status" -ne 0 ]
    [[ "$output" == *"already exists"* ]]
    [ -f "$TEST_DIR/project/.arb/templates/repos/repo-b/.env" ]
    [ "$(cat "$TEST_DIR/project/.arb/templates/repos/repo-a/.env")" = "OLD" ]
}

@test "arb template add directory adds all files recursively with --workspace" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/my-feature/.idea"
    echo "file-a" > "$TEST_DIR/project/my-feature/.idea/workspace.xml"
    echo "file-b" > "$TEST_DIR/project/my-feature/.idea/modules.xml"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .idea --workspace
    [ "$status" -eq 0 ]
    [[ "$output" == *"Added template"* ]]
    [ -f "$TEST_DIR/project/.arb/templates/workspace/.idea/workspace.xml" ]
    [ -f "$TEST_DIR/project/.arb/templates/workspace/.idea/modules.xml" ]
}

@test "arb template add directory adds all files for repo scope" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/my-feature/repo-a/.idea"
    echo "repo-file" > "$TEST_DIR/project/my-feature/repo-a/.idea/misc.xml"
    cd "$TEST_DIR/project/my-feature/repo-a"
    run arb template add .idea
    [ "$status" -eq 0 ]
    [[ "$output" == *"Added template"* ]]
    [ -f "$TEST_DIR/project/.arb/templates/repos/repo-a/.idea/misc.xml" ]
}

@test "arb template add directory handles nested subdirectories" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/my-feature/.claude/settings"
    echo "top" > "$TEST_DIR/project/my-feature/.claude/config.json"
    echo "nested" > "$TEST_DIR/project/my-feature/.claude/settings/local.json"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .claude --workspace
    [ "$status" -eq 0 ]
    [ -f "$TEST_DIR/project/.arb/templates/workspace/.claude/config.json" ]
    [ -f "$TEST_DIR/project/.arb/templates/workspace/.claude/settings/local.json" ]
    [ "$(cat "$TEST_DIR/project/.arb/templates/workspace/.claude/settings/local.json")" = "nested" ]
}

@test "arb template add directory with --force overwrites existing templates" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace/.idea"
    echo "OLD" > "$TEST_DIR/project/.arb/templates/workspace/.idea/workspace.xml"
    mkdir -p "$TEST_DIR/project/my-feature/.idea"
    echo "NEW" > "$TEST_DIR/project/my-feature/.idea/workspace.xml"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .idea --workspace --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"Updated template"* ]]
    [ "$(cat "$TEST_DIR/project/.arb/templates/workspace/.idea/workspace.xml")" = "NEW" ]
}

@test "arb template add directory refuses overwrite without --force" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace/.idea"
    echo "OLD" > "$TEST_DIR/project/.arb/templates/workspace/.idea/workspace.xml"
    mkdir -p "$TEST_DIR/project/my-feature/.idea"
    echo "NEW" > "$TEST_DIR/project/my-feature/.idea/workspace.xml"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .idea --workspace
    [ "$status" -ne 0 ]
    [[ "$output" == *"already exists"* ]]
}

@test "arb template add directory with --repo adds all files for explicit repo" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/my-feature/repo-a/.idea"
    echo "explicit" > "$TEST_DIR/project/my-feature/repo-a/.idea/misc.xml"
    cd "$TEST_DIR/project/my-feature"
    run arb template add repo-a/.idea --repo repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"Added template"* ]]
    [ -f "$TEST_DIR/project/.arb/templates/repos/repo-a/.idea/misc.xml" ]
    [ "$(cat "$TEST_DIR/project/.arb/templates/repos/repo-a/.idea/misc.xml")" = "explicit" ]
}

@test "arb template add directory with auto-detected workspace scope" {
    arb create my-feature repo-a >/dev/null 2>&1
    mkdir -p "$TEST_DIR/project/my-feature/.config"
    echo "auto" > "$TEST_DIR/project/my-feature/.config/settings.json"
    cd "$TEST_DIR/project/my-feature"
    run arb template add .config --workspace
    [ "$status" -eq 0 ]
    [ -f "$TEST_DIR/project/.arb/templates/workspace/.config/settings.json" ]
    # Now verify it applies to a new workspace
    arb create second-ws repo-a >/dev/null 2>&1
    [ -f "$TEST_DIR/project/second-ws/.config/settings.json" ]
    [ "$(cat "$TEST_DIR/project/second-ws/.config/settings.json")" = "auto" ]
}

@test "arb template list aligns modified annotations" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "SHORT" > "$TEST_DIR/project/.arb/templates/workspace/.env"
    echo "LONG" > "$TEST_DIR/project/.arb/templates/workspace/some-longer-filename.txt"
    arb create my-feature repo-a >/dev/null 2>&1
    echo "CHANGED" > "$TEST_DIR/project/my-feature/.env"
    echo "CHANGED" > "$TEST_DIR/project/my-feature/some-longer-filename.txt"
    cd "$TEST_DIR/project/my-feature"
    run arb template list
    [ "$status" -eq 0 ]
    # Both should show (modified) and the output should contain padding
    [[ "$output" == *".env"*"(modified)"* ]]
    [[ "$output" == *"some-longer-filename.txt"*"(modified)"* ]]
}

# ── .arbtemplate LiquidJS rendering ───────────────────────────────

@test "arb create applies .arbtemplate with workspace variables" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{{ workspace.name }}:{{ workspace.path }}:{{ root.path }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"

    arb create tpl-sub-ws repo-a
    [ -f "$TEST_DIR/project/tpl-sub-ws/config.json" ]
    [ ! -f "$TEST_DIR/project/tpl-sub-ws/config.json.arbtemplate" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-sub-ws/config.json")"
    [[ "$content" == "tpl-sub-ws:$TEST_DIR/project/tpl-sub-ws:$TEST_DIR/project" ]]
}

@test "arb create applies .arbtemplate with repo variables" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    printf '{{ repo.name }}:{{ repo.path }}' \
        > "$TEST_DIR/project/.arb/templates/repos/repo-a/settings.json.arbtemplate"

    arb create tpl-sub-repo repo-a
    [ -f "$TEST_DIR/project/tpl-sub-repo/repo-a/settings.json" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-sub-repo/repo-a/settings.json")"
    [[ "$content" == "repo-a:$TEST_DIR/project/tpl-sub-repo/repo-a" ]]
}

@test "arb template apply seeds .arbtemplate with rendering" {
    arb create tpl-apply-sub repo-a >/dev/null 2>&1
    # Set up templates AFTER create so they haven't been seeded yet
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/marker.txt.arbtemplate"
    cd "$TEST_DIR/project/tpl-apply-sub"
    run arb template apply
    [ "$status" -eq 0 ]
    [[ "$output" == *"Seeded"* ]]
    [ "$(cat "$TEST_DIR/project/tpl-apply-sub/marker.txt")" = "tpl-apply-sub" ]
}

@test "arb template apply --force resets .arbtemplate files to rendered content" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/marker.txt.arbtemplate"
    arb create tpl-force-sub repo-a >/dev/null 2>&1
    echo "DRIFTED" > "$TEST_DIR/project/tpl-force-sub/marker.txt"
    cd "$TEST_DIR/project/tpl-force-sub"
    run arb template apply --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"reset"* ]]
    [ "$(cat "$TEST_DIR/project/tpl-force-sub/marker.txt")" = "tpl-force-sub" ]
}

@test "arb template diff compares rendered content for .arbtemplate" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/marker.txt.arbtemplate"
    arb create tpl-diff-sub repo-a >/dev/null 2>&1
    # Content matches rendered value — no drift expected
    cd "$TEST_DIR/project/tpl-diff-sub"
    run arb template diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"No changes"* ]]

    # Now modify to create drift
    echo "wrong" > "$TEST_DIR/project/tpl-diff-sub/marker.txt"
    run arb template diff
    [ "$status" -eq 1 ]
}

@test "arb template list shows (template) annotation for .arbtemplate" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"
    echo "static" > "$TEST_DIR/project/.arb/templates/workspace/plain.txt"
    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"config.json"*"(template)"* ]]
    [[ "$output" == *"plain.txt"* ]]
}

@test "arb template remove works with stripped name for .arbtemplate" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"
    arb create my-feature repo-a >/dev/null 2>&1
    cd "$TEST_DIR/project/my-feature"
    run arb template remove config.json --workspace
    [ "$status" -eq 0 ]
    [[ "$output" == *"Removed template"* ]]
    [ ! -f "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate" ]
}

@test "mix of .arbtemplate and regular files in same template directory" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/dynamic.txt.arbtemplate"
    echo "static content" > "$TEST_DIR/project/.arb/templates/workspace/static.txt"

    arb create tpl-mix-test repo-a
    [ -f "$TEST_DIR/project/tpl-mix-test/dynamic.txt" ]
    [ -f "$TEST_DIR/project/tpl-mix-test/static.txt" ]
    [ "$(cat "$TEST_DIR/project/tpl-mix-test/dynamic.txt")" = "tpl-mix-test" ]
    [ "$(cat "$TEST_DIR/project/tpl-mix-test/static.txt")" = "static content" ]
}

# ── template conflict detection ──────────────────────────────────

@test "arb create warns when both plain and .arbtemplate exist" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "plain" > "$TEST_DIR/project/.arb/templates/workspace/config.json"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"

    run arb create tpl-conflict-test repo-a
    [ "$status" -eq 0 ]
    [[ "$output" == *"Conflict"* ]]
    [[ "$output" == *"config.json"* ]]
    # The file should still be created (first one wins)
    [ -f "$TEST_DIR/project/tpl-conflict-test/config.json" ]
}

@test "arb template list shows conflict annotation when both variants exist" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "plain" > "$TEST_DIR/project/.arb/templates/workspace/config.json"
    printf '{{ workspace.name }}' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"

    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"config.json"* ]]
    [[ "$output" == *"(conflict)"* ]]
}

# ── repo-aware templates (iteration) ──────────────────────────────

@test "arb create renders template with repo list" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-iter repo-a repo-b
    [ -f "$TEST_DIR/project/tpl-iter/repos.txt" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-iter/repos.txt")"
    [[ "$content" == *"repo-a"* ]]
    [[ "$content" == *"repo-b"* ]]
}

@test "arb attach regenerates repo-aware workspace template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-attach-regen repo-a
    # Should have been seeded with just repo-a
    local before
    before="$(cat "$TEST_DIR/project/tpl-attach-regen/repos.txt")"
    [[ "$before" == *"repo-a"* ]]
    [[ "$before" != *"repo-b"* ]]

    cd "$TEST_DIR/project/tpl-attach-regen"
    run arb attach repo-b
    [ "$status" -eq 0 ]
    [[ "$output" == *"Regenerated"* ]]

    local after
    after="$(cat "$TEST_DIR/project/tpl-attach-regen/repos.txt")"
    [[ "$after" == *"repo-a"* ]]
    [[ "$after" == *"repo-b"* ]]
}

@test "arb detach regenerates repo-aware workspace template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-detach-regen repo-a repo-b
    local before
    before="$(cat "$TEST_DIR/project/tpl-detach-regen/repos.txt")"
    [[ "$before" == *"repo-a"* ]]
    [[ "$before" == *"repo-b"* ]]

    cd "$TEST_DIR/project/tpl-detach-regen"
    run arb detach repo-b
    [ "$status" -eq 0 ]
    [[ "$output" == *"Regenerated"* ]]

    local after
    after="$(cat "$TEST_DIR/project/tpl-detach-regen/repos.txt")"
    [[ "$after" == *"repo-a"* ]]
    [[ "$after" != *"repo-b"* ]]
}

@test "arb attach skips overwrite when user has edited repo-aware template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-user-edit repo-a
    # User edits the file
    echo "my custom repos list" > "$TEST_DIR/project/tpl-user-edit/repos.txt"

    cd "$TEST_DIR/project/tpl-user-edit"
    arb attach repo-b

    # File should NOT be overwritten
    local content
    content="$(cat "$TEST_DIR/project/tpl-user-edit/repos.txt")"
    [[ "$content" == "my custom repos list" ]]
}

@test "arb template apply --force overwrites user-edited repo-aware template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-force-regen repo-a repo-b
    echo "user edited" > "$TEST_DIR/project/tpl-force-regen/repos.txt"

    cd "$TEST_DIR/project/tpl-force-regen"
    run arb template apply --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"reset"* ]]
    local content
    content="$(cat "$TEST_DIR/project/tpl-force-regen/repos.txt")"
    [[ "$content" == *"repo-a"* ]]
    [[ "$content" == *"repo-b"* ]]
}

@test "forloop.last works for trailing comma in JSON template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    cat > "$TEST_DIR/project/.arb/templates/workspace/modules.json.arbtemplate" << 'TMPL'
{%- for wt in workspace.repos %}
"{{ wt.name }}"{% unless forloop.last %},{% endunless %}
{%- endfor %}
TMPL

    arb create tpl-comma repo-a repo-b
    local content
    content="$(cat "$TEST_DIR/project/tpl-comma/modules.json")"
    # Should have comma between items but not after last
    [[ "$content" == *'"repo-a",'* ]]
    [[ "$content" == *'"repo-b"'* ]]
    # Last item should NOT have trailing comma
    [[ "$content" != *'"repo-b",'* ]]
}

@test "workspace.repos available in repo-scoped template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    printf 'siblings: {%% for wt in workspace.repos %%}{{ wt.name }} {%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/repos/repo-a/siblings.txt.arbtemplate"

    arb create tpl-siblings repo-a repo-b
    [ -f "$TEST_DIR/project/tpl-siblings/repo-a/siblings.txt" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-siblings/repo-a/siblings.txt")"
    [[ "$content" == *"repo-a"* ]]
    [[ "$content" == *"repo-b"* ]]
}

@test "sequential attach/detach maintains correct template state" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-seq repo-a
    cd "$TEST_DIR/project/tpl-seq"

    # Attach repo-b
    arb attach repo-b
    local after_attach
    after_attach="$(cat "$TEST_DIR/project/tpl-seq/repos.txt")"
    [[ "$after_attach" == *"repo-a"* ]]
    [[ "$after_attach" == *"repo-b"* ]]

    # Detach repo-a
    arb detach repo-a
    local after_detach
    after_detach="$(cat "$TEST_DIR/project/tpl-seq/repos.txt")"
    [[ "$after_detach" != *"repo-a"* ]]
    [[ "$after_detach" == *"repo-b"* ]]
}

@test "arb template diff detects drift with repo-aware template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-diff-iter repo-a repo-b
    # No drift initially
    cd "$TEST_DIR/project/tpl-diff-iter"
    run arb template diff
    [ "$status" -eq 0 ]
    [[ "$output" == *"No changes"* ]]

    # Modify the file
    echo "wrong" > "$TEST_DIR/project/tpl-diff-iter/repos.txt"
    run arb template diff
    [ "$status" -eq 1 ]
}

@test "arb template list shows drift for repo-aware template" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/repos.txt.arbtemplate"

    arb create tpl-list-iter repo-a
    cd "$TEST_DIR/project/tpl-list-iter"
    echo "wrong" > "$TEST_DIR/project/tpl-list-iter/repos.txt"
    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"(modified)"* ]]
}

# ── remote URL in templates ───────────────────────────────────────

@test "arb create renders template with baseRemote.url" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.name }}={{ wt.baseRemote.url }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/remotes.txt.arbtemplate"

    arb create tpl-remote repo-a
    [ -f "$TEST_DIR/project/tpl-remote/remotes.txt" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-remote/remotes.txt")"
    # repo-a has origin remote pointing to the bare repo
    [[ "$content" == *"repo-a="* ]]
    [[ "$content" == *"repo-a.git"* ]]
}

@test "arb create renders template with shareRemote.url" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.shareRemote.url }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/share.txt.arbtemplate"

    arb create tpl-share repo-a
    [ -f "$TEST_DIR/project/tpl-share/share.txt" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-share/share.txt")"
    [[ "$content" == *"repo-a.git"* ]]
}

@test "arb create renders template with baseRemote.name" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}{{ wt.baseRemote.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/remote-names.txt.arbtemplate"

    arb create tpl-rname repo-a
    [ -f "$TEST_DIR/project/tpl-rname/remote-names.txt" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-rname/remote-names.txt")"
    # Single-remote repo: origin is used for both roles
    [[ "$content" == *"origin"* ]]
}

@test "repo-scoped template accesses repo.baseRemote.url" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    printf '{{ repo.baseRemote.url }}' \
        > "$TEST_DIR/project/.arb/templates/repos/repo-a/base-url.txt.arbtemplate"

    arb create tpl-repo-remote repo-a
    [ -f "$TEST_DIR/project/tpl-repo-remote/repo-a/base-url.txt" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-repo-remote/repo-a/base-url.txt")"
    [[ "$content" == *"repo-a.git"* ]]
}

@test "fork repo template renders upstream and origin remotes" {
    setup_fork_repo repo-a

    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '{%% for wt in workspace.repos %%}base={{ wt.baseRemote.name }} share={{ wt.shareRemote.name }}\n{%% endfor %%}' \
        > "$TEST_DIR/project/.arb/templates/workspace/fork-remotes.txt.arbtemplate"

    arb create tpl-fork repo-a
    [ -f "$TEST_DIR/project/tpl-fork/fork-remotes.txt" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-fork/fork-remotes.txt")"
    [[ "$content" == *"base=upstream"* ]]
    [[ "$content" == *"share=origin"* ]]
}
