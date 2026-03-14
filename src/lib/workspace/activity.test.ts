import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRepoActivityDate, getWorkspaceActivityDate } from "./activity";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "arb-activity-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function initGitRepo(dir: string): Promise<void> {
  const proc = Bun.spawnSync(["git", "init", dir], { stdout: "ignore", stderr: "ignore" });
  if (proc.exitCode !== 0) throw new Error(`git init failed in ${dir}`);
  Bun.spawnSync(["git", "-C", dir, "config", "user.email", "test@test.com"], { stdout: "ignore", stderr: "ignore" });
  Bun.spawnSync(["git", "-C", dir, "config", "user.name", "Test"], { stdout: "ignore", stderr: "ignore" });
}

describe("getRepoActivityDate", () => {
  test("returns activity date for repo with tracked files", async () => {
    const repoDir = join(tmpDir, "repo");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "hello");
    Bun.spawnSync(["git", "-C", repoDir, "add", "file.txt"], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "init", "--no-gpg-sign"], {
      stdout: "ignore",
      stderr: "ignore",
    });

    const result = await getRepoActivityDate(repoDir);
    expect(result).not.toBeNull();
    expect(result?.date).toBeTruthy();
    expect(result?.file).toContain("file.txt");
  });

  test("returns null for empty repo with no files", async () => {
    const repoDir = join(tmpDir, "empty-repo");
    await initGitRepo(repoDir);

    const result = await getRepoActivityDate(repoDir);
    expect(result).toBeNull();
  });

  test("returns null for non-git directory", async () => {
    const dir = join(tmpDir, "not-a-repo");
    mkdirSync(dir);

    const result = await getRepoActivityDate(dir);
    expect(result).toBeNull();
  });

  test("includes untracked files in scan", async () => {
    const repoDir = join(tmpDir, "repo-untracked");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "tracked.txt"), "hello");
    Bun.spawnSync(["git", "-C", repoDir, "add", "tracked.txt"], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "init", "--no-gpg-sign"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    // Add untracked file with a slightly newer mtime
    writeFileSync(join(repoDir, "untracked.txt"), "world");

    const result = await getRepoActivityDate(repoDir);
    expect(result).not.toBeNull();
    // The untracked file should be found (git ls-files --others --exclude-standard)
    expect(result?.file).toContain("untracked.txt");
  });
});

describe("getWorkspaceActivityDate", () => {
  test("returns most recent date across repos and non-repo items", async () => {
    const wsDir = join(tmpDir, "workspace");
    mkdirSync(wsDir);
    mkdirSync(join(wsDir, ".arbws"));

    // Create a repo dir
    const repoDir = join(wsDir, "repo-a");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "old.txt"), "old");
    Bun.spawnSync(["git", "-C", repoDir, "add", "."], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "init", "--no-gpg-sign"], {
      stdout: "ignore",
      stderr: "ignore",
    });

    // Create a non-repo item that's newer
    const notesDir = join(wsDir, "notes");
    mkdirSync(notesDir);
    writeFileSync(join(notesDir, "todo.md"), "new content");

    const result = await getWorkspaceActivityDate(wsDir, [repoDir]);
    expect(result).not.toBeNull();
    expect(result?.date).toBeTruthy();
  });

  test("skips .arbws directory", async () => {
    const wsDir = join(tmpDir, "ws-arbws");
    mkdirSync(wsDir);
    mkdirSync(join(wsDir, ".arbws"));
    writeFileSync(join(wsDir, ".arbws", "config.json"), '{"branch":"test"}');

    const result = await getWorkspaceActivityDate(wsDir, []);
    // .arbws should be skipped; no other files → null
    expect(result).toBeNull();
  });

  test("returns null for empty workspace", async () => {
    const wsDir = join(tmpDir, "empty-ws");
    mkdirSync(wsDir);

    const result = await getWorkspaceActivityDate(wsDir, []);
    expect(result).toBeNull();
  });

  test("returns null for nonexistent workspace", async () => {
    const result = await getWorkspaceActivityDate(join(tmpDir, "nonexistent"), []);
    expect(result).toBeNull();
  });
});
