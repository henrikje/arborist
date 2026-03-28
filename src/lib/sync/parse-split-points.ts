import { ArbError } from "../core/errors";
import { gitLocal } from "../git/git";

// ── Types ──

export interface SplitPointSpec {
  repo: string | null; // null = auto-detect from SHA
  commitish: string;
}

export interface ResolvedSplitPoint {
  repo: string;
  commitSha: string;
}

// ── Parsing ──

/** Parse a single value like "abc123" or "api:HEAD~3" into a SplitPointSpec. */
export function parseSplitPointValue(value: string): SplitPointSpec {
  const colonIdx = value.indexOf(":");
  if (colonIdx === -1) {
    return { repo: null, commitish: value };
  }
  const repo = value.slice(0, colonIdx);
  const commitish = value.slice(colonIdx + 1);
  if (!repo || !commitish) {
    throw new ArbError(`Invalid split point "${value}" — expected "<repo>:<commit-ish>" or a bare commit-ish`);
  }
  return { repo, commitish };
}

/** Parse an array of values, splitting comma-separated entries. */
export function parseSplitPoints(values: string[]): SplitPointSpec[] {
  const specs: SplitPointSpec[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        specs.push(parseSplitPointValue(trimmed));
      }
    }
  }
  return specs;
}

// ── Resolution ──

/**
 * Resolve parsed SplitPointSpecs into per-repo commit SHAs.
 *
 * - Bare SHAs auto-detect their repo by checking which repo contains the commit.
 * - Validates: repo exists in workspace, commit resolves, no duplicate repos,
 *   commit is at or above the merge-base.
 */
export async function resolveSplitPoints(
  specs: SplitPointSpec[],
  repos: string[],
  wsDir: string,
  mergeBaseMap: Map<string, string>,
): Promise<Map<string, ResolvedSplitPoint>> {
  const resolved = new Map<string, ResolvedSplitPoint>();

  for (const spec of specs) {
    if (spec.repo) {
      // Explicit repo — validate and resolve
      if (!repos.includes(spec.repo)) {
        throw new ArbError(`repo "${spec.repo}" is not in this workspace`);
      }
      const sha = await resolveCommitInRepo(wsDir, spec.repo, spec.commitish);
      checkDuplicate(resolved, spec.repo);
      await checkMergeBaseFloor(sha, spec.repo, mergeBaseMap, wsDir);
      resolved.set(spec.repo, { repo: spec.repo, commitSha: sha });
    } else {
      // Bare value — auto-detect repo
      const match = await autoDetectRepo(wsDir, repos, spec.commitish);
      checkDuplicate(resolved, match.repo);
      await checkMergeBaseFloor(match.commitSha, match.repo, mergeBaseMap, wsDir);
      resolved.set(match.repo, match);
    }
  }

  return resolved;
}

// ── Helpers ──

async function resolveCommitInRepo(wsDir: string, repo: string, commitish: string): Promise<string> {
  const repoDir = `${wsDir}/${repo}`;
  const result = await gitLocal(repoDir, "rev-parse", "--verify", commitish);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new ArbError(`cannot resolve "${commitish}" in repo "${repo}"`);
  }
  return result.stdout.trim();
}

async function autoDetectRepo(wsDir: string, repos: string[], commitish: string): Promise<ResolvedSplitPoint> {
  const matches: ResolvedSplitPoint[] = [];

  for (const repo of repos) {
    const repoDir = `${wsDir}/${repo}`;
    const result = await gitLocal(repoDir, "rev-parse", "--verify", commitish);
    if (result.exitCode === 0 && result.stdout.trim()) {
      matches.push({ repo, commitSha: result.stdout.trim() });
    }
  }

  if (matches.length === 0) {
    throw new ArbError(`cannot resolve "${commitish}" in any repo in this workspace`);
  }
  if (matches.length > 1) {
    const repoNames = matches.map((m) => m.repo).join(", ");
    throw new ArbError(
      `"${commitish}" found in multiple repos (${repoNames}) — use "<repo>:${commitish}" to disambiguate`,
    );
  }
  // Safe: we checked matches.length === 1 above
  const match = matches[0];
  if (!match) throw new ArbError("unexpected: no match after length check");
  return match;
}

function checkDuplicate(resolved: Map<string, ResolvedSplitPoint>, repo: string): void {
  if (resolved.has(repo)) {
    throw new ArbError(`duplicate split point for repo "${repo}"`);
  }
}

async function checkMergeBaseFloor(
  sha: string,
  repo: string,
  mergeBaseMap: Map<string, string>,
  wsDir: string,
): Promise<void> {
  const mergeBase = mergeBaseMap.get(repo);
  if (!mergeBase) return; // No merge-base available — skip check (repo may have no base)

  const repoDir = `${wsDir}/${repo}`;
  // Check: is the merge-base an ancestor of the split point?
  // If not, the split point is below the merge-base.
  const result = await gitLocal(repoDir, "merge-base", "--is-ancestor", mergeBase, sha);
  if (result.exitCode !== 0) {
    throw new ArbError(
      `commit ${sha.slice(0, 7)} is already on the base branch in repo '${repo}' — only your branch's own commits can be extracted`,
    );
  }
}
