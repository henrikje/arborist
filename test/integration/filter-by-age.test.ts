import { describe, expect, test } from "bun:test";
import { type Dirent, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { arb, git, withEnv, write } from "./helpers/env";

// ── Helpers ──────────────────────────────────────────────────────

/** Recursively set mtime of all files and dirs under path to date. */
function backdateMtime(path: string, date: Date): void {
  let entries: Dirent[] | undefined;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(path, entry.name);
    try {
      utimesSync(full, date, date);
      if (entry.isDirectory()) backdateMtime(full, date);
    } catch {
      // ignore unreadable entries
    }
  }
  try {
    utimesSync(path, date, date);
  } catch {
    // ignore
  }
}

type Env = Parameters<Parameters<typeof withEnv>[0]>[0];

/** Create ws-old (3+ days ago) and ws-new (just created). */
async function setupOldAndNew(env: Env): Promise<void> {
  // ws-new: freshly created
  await arb(env, ["create", "ws-new", "repo-a"]);

  // ws-old: commit backdated to 3 days ago, file mtimes also backdated
  await arb(env, ["create", "ws-old", "repo-b"]);
  const wsOldRepoDir = join(env.projectDir, "ws-old", "repo-b");
  const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const oldDateStr = oldDate.toISOString();
  await write(join(wsOldRepoDir, "work.txt"), "old work");
  await git(wsOldRepoDir, ["add", "work.txt"]);
  // --date sets the author date (used by getHeadCommitDate via --format=%aI)
  await git(wsOldRepoDir, ["commit", `--date=${oldDateStr}`, "-m", "old work"]);
  // Push so ws-old has no unpushed commits (safe to delete without --force)
  await git(wsOldRepoDir, ["push", "--set-upstream", "origin", "ws-old"]);
  backdateMtime(join(env.projectDir, "ws-old"), oldDate);
}

// ── Invalid duration errors ───────────────────────────────────────

describe("--older-than / --newer-than: invalid duration", () => {
  test("arb list --older-than with missing unit errors", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["list", "--older-than", "30", "--no-fetch"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid duration");
    }));

  test("arb list --older-than with unknown unit errors", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["list", "--older-than", "30h", "--no-fetch"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid duration");
    }));

  test("arb list --newer-than with invalid value errors", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["list", "--newer-than", "abc", "--no-fetch"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid duration");
    }));

  test("arb delete --older-than with invalid value errors", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["delete", "--older-than", "xyz", "--no-fetch", "--dry-run"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid duration");
    }));

  test("arb delete --newer-than with invalid value errors", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["delete", "--newer-than", "xyz", "--no-fetch", "--dry-run"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid duration");
    }));
});

// ── arb list --older-than / --newer-than ─────────────────────────

describe("arb list --older-than", () => {
  test("shows old workspace and excludes new workspace", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["list", "--older-than", "1d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-old");
      expect(result.output).not.toContain("ws-new");
    }));

  test("produces empty output when no workspaces are old enough", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-new", "repo-a"]);
      const result = await arb(env, ["list", "--older-than", "30d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("ws-new");
    }));
});

describe("arb list --newer-than", () => {
  test("shows new workspace and excludes old workspace", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["list", "--newer-than", "1d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-new");
      expect(result.output).not.toContain("ws-old");
    }));
});

describe("arb list --older-than composed with --where", () => {
  test("combines as AND: must match both age and status filter", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      // setupOldAndNew pushes ws-old's commit, so add an unpushed one
      const wsOldRepoDir = join(env.projectDir, "ws-old", "repo-b");
      const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await write(join(wsOldRepoDir, "extra.txt"), "unpushed work");
      await git(wsOldRepoDir, ["add", "extra.txt"]);
      await git(wsOldRepoDir, ["commit", `--date=${oldDate.toISOString()}`, "-m", "unpushed work"]);
      backdateMtime(join(env.projectDir, "ws-old"), oldDate);
      // ws-old now has an unpushed commit; ws-new has no commits ahead of base
      const result = await arb(env, ["list", "--older-than", "1d", "--where", "unpushed", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-old");
      expect(result.output).not.toContain("ws-new");
    }));
});

describe("arb list --quiet --older-than", () => {
  test("outputs workspace name per line", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["list", "--quiet", "--older-than", "1d"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("ws-old");
    }));
});

describe("arb list --json --older-than", () => {
  test("filters JSON output", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["list", "--json", "--older-than", "1d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      const entries = JSON.parse(result.stdout) as { workspace: string }[];
      const names = entries.map((e) => e.workspace);
      expect(names).toContain("ws-old");
      expect(names).not.toContain("ws-new");
    }));
});

// ── arb delete --older-than ───────────────────────────────────────

describe("arb delete --older-than", () => {
  test("--dry-run shows old workspace without deleting", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["delete", "--older-than", "1d", "--dry-run", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-old");
      expect(result.output).not.toContain("ws-new");
      // workspace still exists
      const listResult = await arb(env, ["list", "--no-fetch"]);
      expect(listResult.output).toContain("ws-old");
    }));

  test("--yes deletes old workspace and leaves new intact", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["delete", "--older-than", "1d", "--yes", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      const listResult = await arb(env, ["list", "--no-fetch"]);
      expect(listResult.output).not.toContain("ws-old");
      expect(listResult.output).toContain("ws-new");
    }));

  test("no matches exits cleanly with message", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-new", "repo-a"]);
      const result = await arb(env, ["delete", "--older-than", "30d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("No workspaces match");
    }));
});

describe("arb delete --newer-than", () => {
  test("--dry-run shows new workspace without deleting", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["delete", "--newer-than", "1d", "--dry-run", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-new");
      expect(result.output).not.toContain("ws-old");
      const listResult = await arb(env, ["list", "--no-fetch"]);
      expect(listResult.output).toContain("ws-new");
    }));

  test("--yes deletes new workspace and leaves old intact", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const result = await arb(env, ["delete", "--newer-than", "1d", "--yes", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      const listResult = await arb(env, ["list", "--no-fetch"]);
      expect(listResult.output).toContain("ws-old");
      expect(listResult.output).not.toContain("ws-new");
    }));

  test("composes with --where as AND", () =>
    withEnv(async (env) => {
      await setupOldAndNew(env);
      const wsNewRepoDir = join(env.projectDir, "ws-new", "repo-a");
      await write(join(wsNewRepoDir, "extra.txt"), "unpushed work");
      await git(wsNewRepoDir, ["add", "extra.txt"]);
      await git(wsNewRepoDir, ["commit", "-m", "unpushed work"]);

      const result = await arb(env, [
        "delete",
        "--newer-than",
        "1d",
        "--where",
        "unpushed",
        "--dry-run",
        "--force",
        "--no-fetch",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-new");
      expect(result.output).not.toContain("ws-old");
    }));

  test("no matches exits cleanly with message", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-old", "repo-a"]);
      const wsDir = join(env.projectDir, "ws-old");
      const wsRepoDir = join(wsDir, "repo-a");
      const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const oldDateStr = oldDate.toISOString();

      await write(join(wsRepoDir, "work.txt"), "old work");
      await git(wsRepoDir, ["add", "work.txt"]);
      await git(wsRepoDir, ["commit", `--date=${oldDateStr}`, "-m", "old work"]);
      backdateMtime(wsDir, oldDate);

      const result = await arb(env, ["delete", "--newer-than", "1d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("No workspaces match");
    }));
});

// ── Activity detection: unstaged file edits ───────────────────────

describe("activity detection: unstaged file edits", () => {
  test("workspace with recent unstaged file is NOT matched by --older-than", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-active", "repo-a"]);
      const wsDir = join(env.projectDir, "ws-active");
      const wsRepoDir = join(wsDir, "repo-a");
      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const oldDateStr = oldDate.toISOString();

      // Make an old commit
      await write(join(wsRepoDir, "work.txt"), "initial");
      await git(wsRepoDir, ["add", "work.txt"]);
      await git(wsRepoDir, ["commit", `--date=${oldDateStr}`, "-m", "old commit"]);

      // Backdate everything to simulate an abandoned workspace
      backdateMtime(wsDir, oldDate);

      // Now create a new untracked file (current mtime) — workspace is "active"
      await write(join(wsRepoDir, "wip.txt"), "work in progress");

      const result = await arb(env, ["list", "--older-than", "1d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      // Recent untracked file means workspace is active — should NOT appear
      expect(result.output).not.toContain("ws-active");
    }));
});

// ── Activity detection: .claude/ at workspace level ───────────────

describe("activity detection: .claude/ directory", () => {
  test("workspace with recent .claude/ activity is NOT matched by --older-than", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-active", "repo-a"]);
      const wsDir = join(env.projectDir, "ws-active");
      const wsRepoDir = join(wsDir, "repo-a");
      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const oldDateStr = oldDate.toISOString();

      // Make an old commit
      await write(join(wsRepoDir, "work.txt"), "initial");
      await git(wsRepoDir, ["add", "work.txt"]);
      await git(wsRepoDir, ["commit", `--date=${oldDateStr}`, "-m", "old commit"]);

      // Backdate everything
      backdateMtime(wsDir, oldDate);

      // Add a .claude/ conversation at workspace level (git-ignored, current mtime)
      await write(join(wsDir, ".claude", "conversation.md"), "planning notes");

      const result = await arb(env, ["list", "--older-than", "1d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      // Recent .claude/ activity means workspace is active — should NOT appear
      expect(result.output).not.toContain("ws-active");
    }));

  test("workspace with only old .claude/ activity IS matched by --older-than", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-old", "repo-a"]);
      const wsDir = join(env.projectDir, "ws-old");
      const wsRepoDir = join(wsDir, "repo-a");
      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const oldDateStr = oldDate.toISOString();

      await write(join(wsRepoDir, "work.txt"), "initial");
      await git(wsRepoDir, ["add", "work.txt"]);
      await git(wsRepoDir, ["commit", `--date=${oldDateStr}`, "-m", "old commit"]);

      // Add .claude/ conversation BEFORE backdating
      await write(join(wsDir, ".claude", "conversation.md"), "old planning");

      // Backdate everything including .claude/
      backdateMtime(wsDir, oldDate);

      const result = await arb(env, ["list", "--older-than", "1d", "--no-fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-old");
    }));
});
