import { gitLocal } from "../git/git";

export async function predictMergeConflict(
  repoDir: string,
  ref: string,
): Promise<{ hasConflict: boolean; files: string[] } | null> {
  const result = await gitLocal(repoDir, "merge-tree", "--write-tree", "--name-only", "HEAD", ref);
  if (result.exitCode === 0) return { hasConflict: false, files: [] };
  if (result.exitCode === 1) {
    // Exit 1 with stdout = conflict detected (stdout has tree hash + file list)
    // Exit 1 without stdout = error (e.g. invalid ref — error goes to stderr)
    if (!result.stdout.trim()) return null;
    // Skip first line (tree hash), filter CONFLICT/Auto-merging info lines
    const files = result.stdout
      .split("\n")
      .slice(1)
      .filter((line) => line && !line.startsWith("Auto-merging") && !line.startsWith("CONFLICT"));
    return { hasConflict: true, files };
  }
  return null; // unexpected error or old git without merge-tree support
}

export async function predictRebaseConflictCommits(
  repoDir: string,
  targetRef: string,
): Promise<{ shortHash: string; files: string[] }[]> {
  // List incoming commits (commits on targetRef not on HEAD), in chronological order
  const logResult = await gitLocal(repoDir, "log", "--format=%H %h", "--reverse", `HEAD..${targetRef}`);
  if (logResult.exitCode !== 0) return [];
  const commits = logResult.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      return { hash: line.slice(0, spaceIdx), shortHash: line.slice(spaceIdx + 1) };
    });
  if (commits.length === 0) return [];

  const conflicting: { shortHash: string; files: string[] }[] = [];
  for (const commit of commits) {
    // Simulate cherry-picking this commit onto HEAD by using merge-tree
    // merge-base is commit's parent, ours is HEAD, theirs is the commit
    const result = await gitLocal(
      repoDir,
      "merge-tree",
      "--write-tree",
      "--name-only",
      `--merge-base=${commit.hash}~1`,
      "HEAD",
      commit.hash,
    );
    if (result.exitCode === 1 && result.stdout.trim()) {
      // Conflict detected — parse file list (skip tree hash + info lines)
      const files = result.stdout
        .split("\n")
        .slice(1)
        .filter((line) => line && !line.startsWith("Auto-merging") && !line.startsWith("CONFLICT"));
      conflicting.push({ shortHash: commit.shortHash, files });
    }
    // exit 0 = clean, exit >1 = error (e.g. first commit has no parent) — skip
  }
  return conflicting;
}

export async function predictStashPopConflict(repoDir: string, ref: string): Promise<{ overlapping: string[] }> {
  // Get dirty file paths (unstaged + staged)
  const [unstaged, staged] = await Promise.all([
    gitLocal(repoDir, "diff", "--name-only"),
    gitLocal(repoDir, "diff", "--name-only", "--cached"),
  ]);
  const dirtyFiles = new Set<string>();
  for (const line of unstaged.stdout.split("\n").filter(Boolean)) dirtyFiles.add(line);
  for (const line of staged.stdout.split("\n").filter(Boolean)) dirtyFiles.add(line);

  if (dirtyFiles.size === 0) return { overlapping: [] };

  // Get incoming change paths (three-dot diff)
  const incoming = await gitLocal(repoDir, "diff", "--name-only", `HEAD...${ref}`);
  const incomingFiles = new Set<string>();
  if (incoming.exitCode === 0) {
    for (const line of incoming.stdout.split("\n").filter(Boolean)) incomingFiles.add(line);
  }

  const overlapping = [...dirtyFiles].filter((f) => incomingFiles.has(f));
  return { overlapping };
}
