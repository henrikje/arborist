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

@test "arb remove --all-safe --force produces per-workspace output" {
    arb create ws-one repo-a
    arb create ws-two repo-a
    git -C "$TEST_DIR/project/ws-one/repo-a" push -u origin ws-one >/dev/null 2>&1
    git -C "$TEST_DIR/project/ws-two/repo-a" push -u origin ws-two >/dev/null 2>&1

    run arb remove --all-safe --force
    [ "$status" -eq 0 ]
    # Should have columnar table with workspace names
    [[ "$output" == *"ws-one"* ]]
    [[ "$output" == *"ws-two"* ]]
    [[ "$output" == *"no issues"* ]]
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
    # Unified plan: columnar table with workspace names
    [[ "$output" == *"ws-x"* ]]
    [[ "$output" == *"ws-y"* ]]
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
    # Should show columnar table with workspace names
    [[ "$output" == *"tpl-multi-a"* ]]
    [[ "$output" == *"tpl-multi-b"* ]]
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

@test "arb remove --all-safe shows template drift in status table" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "WS=original" > "$TEST_DIR/project/.arb/templates/workspace/.env"

    arb create tpl-allok repo-a
    git -C "$TEST_DIR/project/tpl-allok/repo-a" push -u origin tpl-allok >/dev/null 2>&1
    # Modify workspace-level template file (outside git repos, doesn't affect dirty status)
    echo "WS=modified" > "$TEST_DIR/project/tpl-allok/.env"

    run arb remove --all-safe --force
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
    [[ "$output" == *"Skipping confirmation"* ]]
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
    [[ "$output" == *"Skipping confirmation"* ]]
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

@test "arb remove --all-safe --yes skips confirmation" {
    arb create ws-allok-y repo-a
    git -C "$TEST_DIR/project/ws-allok-y/repo-a" push -u origin ws-allok-y >/dev/null 2>&1

    run arb remove --all-safe --yes
    [ "$status" -eq 0 ]
    [ ! -d "$TEST_DIR/project/ws-allok-y" ]
    [[ "$output" == *"Skipping confirmation"* ]]
}

@test "arb remove --all-safe -d shows remote deletion notice" {
    arb create ws-allok-d repo-a
    git -C "$TEST_DIR/project/ws-allok-d/repo-a" push -u origin ws-allok-d >/dev/null 2>&1

    run arb remove --all-safe --yes -d
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

@test "arb remove --all-safe --where gone narrows to safe-and-gone" {
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
    run arb remove --all-safe --where gone --force
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

# ── .arbtemplate placeholder substitution ─────────────────────────

@test "arb create applies .arbtemplate with workspace placeholders" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '__WORKSPACE_NAME__:__WORKSPACE_PATH__:__ROOT_PATH__' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"

    arb create tpl-sub-ws repo-a
    [ -f "$TEST_DIR/project/tpl-sub-ws/config.json" ]
    [ ! -f "$TEST_DIR/project/tpl-sub-ws/config.json.arbtemplate" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-sub-ws/config.json")"
    [[ "$content" == "tpl-sub-ws:$TEST_DIR/project/tpl-sub-ws:$TEST_DIR/project" ]]
}

@test "arb create applies .arbtemplate with repo placeholders" {
    mkdir -p "$TEST_DIR/project/.arb/templates/repos/repo-a"
    printf '__WORKTREE_NAME__:__WORKTREE_PATH__' \
        > "$TEST_DIR/project/.arb/templates/repos/repo-a/settings.json.arbtemplate"

    arb create tpl-sub-repo repo-a
    [ -f "$TEST_DIR/project/tpl-sub-repo/repo-a/settings.json" ]
    local content
    content="$(cat "$TEST_DIR/project/tpl-sub-repo/repo-a/settings.json")"
    [[ "$content" == "repo-a:$TEST_DIR/project/tpl-sub-repo/repo-a" ]]
}

@test "arb template apply seeds .arbtemplate with substitution" {
    arb create tpl-apply-sub repo-a >/dev/null 2>&1
    # Set up templates AFTER create so they haven't been seeded yet
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '__WORKSPACE_NAME__' \
        > "$TEST_DIR/project/.arb/templates/workspace/marker.txt.arbtemplate"
    cd "$TEST_DIR/project/tpl-apply-sub"
    run arb template apply
    [ "$status" -eq 0 ]
    [[ "$output" == *"Seeded"* ]]
    [ "$(cat "$TEST_DIR/project/tpl-apply-sub/marker.txt")" = "tpl-apply-sub" ]
}

@test "arb template apply --force resets .arbtemplate files to substituted content" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '__WORKSPACE_NAME__' \
        > "$TEST_DIR/project/.arb/templates/workspace/marker.txt.arbtemplate"
    arb create tpl-force-sub repo-a >/dev/null 2>&1
    echo "DRIFTED" > "$TEST_DIR/project/tpl-force-sub/marker.txt"
    cd "$TEST_DIR/project/tpl-force-sub"
    run arb template apply --force
    [ "$status" -eq 0 ]
    [[ "$output" == *"reset"* ]]
    [ "$(cat "$TEST_DIR/project/tpl-force-sub/marker.txt")" = "tpl-force-sub" ]
}

@test "arb template diff compares substituted content for .arbtemplate" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '__WORKSPACE_NAME__' \
        > "$TEST_DIR/project/.arb/templates/workspace/marker.txt.arbtemplate"
    arb create tpl-diff-sub repo-a >/dev/null 2>&1
    # Content matches substituted value — no drift expected
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
    printf '__WORKSPACE_NAME__' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"
    echo "static" > "$TEST_DIR/project/.arb/templates/workspace/plain.txt"
    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"config.json"*"(template)"* ]]
    [[ "$output" == *"plain.txt"* ]]
    # plain.txt should NOT have (template) annotation
    # (We can't easily test absence per-line in BATS, but config.json should have it)
}

@test "arb template remove works with stripped name for .arbtemplate" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '__WORKSPACE_NAME__' \
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
    printf '__WORKSPACE_NAME__' \
        > "$TEST_DIR/project/.arb/templates/workspace/dynamic.txt.arbtemplate"
    echo "static content" > "$TEST_DIR/project/.arb/templates/workspace/static.txt"

    arb create tpl-mix-test repo-a
    [ -f "$TEST_DIR/project/tpl-mix-test/dynamic.txt" ]
    [ -f "$TEST_DIR/project/tpl-mix-test/static.txt" ]
    [ "$(cat "$TEST_DIR/project/tpl-mix-test/dynamic.txt")" = "tpl-mix-test" ]
    [ "$(cat "$TEST_DIR/project/tpl-mix-test/static.txt")" = "static content" ]
}

@test "worktree placeholders left as-is in workspace-scoped templates" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    printf '__WORKTREE_NAME__:__WORKTREE_PATH__' \
        > "$TEST_DIR/project/.arb/templates/workspace/ws-only.txt.arbtemplate"

    arb create tpl-wt-literal repo-a
    local content
    content="$(cat "$TEST_DIR/project/tpl-wt-literal/ws-only.txt")"
    [[ "$content" == "__WORKTREE_NAME__:__WORKTREE_PATH__" ]]
}

# ── template conflict detection ──────────────────────────────────

@test "arb create warns when both plain and .arbtemplate exist" {
    mkdir -p "$TEST_DIR/project/.arb/templates/workspace"
    echo "plain" > "$TEST_DIR/project/.arb/templates/workspace/config.json"
    printf '__WORKSPACE_NAME__' \
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
    printf '__WORKSPACE_NAME__' \
        > "$TEST_DIR/project/.arb/templates/workspace/config.json.arbtemplate"

    run arb template list
    [ "$status" -eq 0 ]
    [[ "$output" == *"config.json"* ]]
    [[ "$output" == *"(conflict)"* ]]
}

