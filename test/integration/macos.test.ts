/**
 * macOS CI subset — only tests that exercise OS/filesystem-specific behavior.
 * Run via: bun test test/integration/macos.test.ts
 *
 * Ubuntu CI runs the full test/integration/ directory.
 * Add new test imports here when they cover OS-specific behavior
 * (case sensitivity, path handling, process spawning, worktree integrity, etc.)
 */
import "./attach.test";
import "./case-sensitivity.test";
import "./create.test";
import "./delete.test";
import "./detach.test";
import "./exec-open.test";
import "./git-timeout.test";
import "./no-color.test";
import "./rename.test";
import "./repo.test";
import "./shell-integration.test";
import "./sync.test";
import "./walkthrough.test";
import "./worktree-integrity.test";
