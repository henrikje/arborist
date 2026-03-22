# Install Reliability Fixes

Date: 2026-03-22

## Context

Running `install.sh` sometimes left `arb` non-functional. Running `uninstall.sh` then `install.sh` again fixed it. Two root causes were identified:

1. **Stale binary inode.** `cp` overwrites the binary in place, preserving the inode. macOS caches code-signing verification per inode, and a stale cache can cause the binary to hang on launch. The uninstall cycle fixed this because `rm` + `cp` allocates a fresh inode.

2. **RC block positioning.** The `.zshrc` Arborist block (PATH export + source line) was skipped when the `# Added by Arborist` marker already existed. If the block appeared *before* `eval "$(brew shellenv)"`, Homebrew's PATH prepend shadowed the source-built binary. The uninstall cycle fixed this because the block was re-added at the end of the file.

A secondary issue: both `install.sh` and `uninstall.sh` used `grep -vF` to remove the block, which globally stripped any line in the file matching the pattern — not just lines that were part of the Arborist block. A user who independently had `export PATH="$HOME/.local/bin:$PATH"` elsewhere in their RC file would have that line silently deleted.

## Options

### Skip if marker present (status quo)
Check for the `# Added by Arborist` marker; if found, skip. Simple, but doesn't fix the PATH ordering bug.
- **Pros:** No unnecessary RC file modifications on reinstall
- **Cons:** Broken when block is positioned before brew shellenv

### Always remove and re-add at end
Remove the existing block (if present) and always append a fresh block at the end of the RC file, using positional awk-based removal that only strips lines immediately adjacent to the marker.
- **Pros:** Fixes PATH ordering; safe removal; idempotent; self-healing for malformed blocks
- **Cons:** Block migrates to end of file on every install

## Decision

Always remove and re-add at end, using positional removal.

## Reasoning

The root cause is block *position*, not content. The PATH prepend must happen after any other PATH modifications (like brew shellenv) to ensure `$HOME/.local/bin` appears first. The only reliable way to guarantee this is to place the block at the end of the RC file.

The switch from `grep -vF` to positional awk removal addresses a safety concern: `grep -vF 'export PATH="$HOME/.local/bin:$PATH"'` would strip *any* line containing that text, even if the user added it independently. The awk approach only removes lines that immediately follow the marker and exactly match our known content.

## Consequences

Every `install.sh` run now modifies the RC file (removes and re-adds the block), even if the content hasn't changed. This is a minor cosmetic cost — the block always appears at the end. The same positional removal logic is used in `uninstall.sh` for consistency.
