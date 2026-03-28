import select, { Separator } from "@inquirer/select";
import { getCommitsBetweenFull } from "../git/git";
import { dim } from "../terminal/output";
import { splitPointSelector } from "../terminal/split-point-selector";
import type { ResolvedSplitPoint } from "./parse-split-points";

interface SelectExtractBoundariesOptions {
  allRepos: string[];
  wsDir: string;
  mergeBaseMap: Map<string, string>;
  newWorkspace: string;
}

interface SelectExtractBoundariesResult {
  direction: "prefix" | "suffix";
  resolvedSplitPoints: Map<string, ResolvedSplitPoint>;
}

interface RepoCommitData {
  commits: { shortHash: string; fullHash: string; subject: string }[];
}

const CONFIRM_SENTINEL = "__confirm__";
const NO_COMMITS_SENTINEL = "__no_commits__";

export async function selectExtractBoundaries(
  options: SelectExtractBoundariesOptions,
): Promise<SelectExtractBoundariesResult> {
  const { allRepos, wsDir, mergeBaseMap, newWorkspace } = options;

  // 1. Direction prompt
  const direction = await select<"prefix" | "suffix">(
    {
      message: `Extract into '${newWorkspace}':`,
      choices: [
        {
          name: "Older commits (base \u2192 boundary)",
          value: "prefix",
        },
        {
          name: "Newer commits (boundary \u2192 HEAD)",
          value: "suffix",
        },
      ],
      loop: false,
    },
    { output: process.stderr },
  );

  // 2. Gather commits per repo
  const repoData = new Map<string, RepoCommitData>();
  for (const repo of allRepos) {
    const mergeBase = mergeBaseMap.get(repo);
    if (!mergeBase) {
      repoData.set(repo, { commits: [] });
      continue;
    }
    const repoDir = `${wsDir}/${repo}`;
    const commits = await getCommitsBetweenFull(repoDir, mergeBase, "HEAD");
    repoData.set(repo, { commits });
  }

  // 3. Switch-menu overview loop
  const splitPoints = new Map<string, ResolvedSplitPoint>();
  const maxRepoLen = Math.max(0, ...allRepos.map((r) => r.length));

  while (true) {
    const choices = buildOverviewChoices(allRepos, repoData, splitPoints, direction, maxRepoLen);
    const selected = await select<string>(
      {
        message: `Select split points for '${newWorkspace}' (${direction} extraction):`,
        choices,
        loop: false,
        pageSize: allRepos.length + 3, // repos + separator + confirm + some margin
      },
      { output: process.stderr, clearPromptOnDone: true },
    );

    if (selected === CONFIRM_SENTINEL) break;
    if (selected === NO_COMMITS_SENTINEL) continue;

    // 4. Per-repo drill-in
    const repo = selected;
    const data = repoData.get(repo);
    if (!data || data.commits.length === 0) continue;

    const currentBoundary = splitPoints.get(repo)?.commitSha ?? null;
    const result = await splitPointSelector(
      {
        repo,
        direction,
        commits: data.commits,
        currentBoundary,
      },
      { output: process.stderr, clearPromptOnDone: true },
    );

    if (result === null) {
      splitPoints.delete(repo);
    } else {
      splitPoints.set(repo, { repo, commitSha: result });
    }
  }

  return { direction, resolvedSplitPoints: splitPoints };
}

function buildOverviewChoices(
  allRepos: string[],
  repoData: Map<string, RepoCommitData>,
  splitPoints: Map<string, ResolvedSplitPoint>,
  direction: "prefix" | "suffix",
  maxRepoLen: number,
): ({ name: string; value: string } | Separator)[] {
  const repoChoices = allRepos.map((repo) => {
    const data = repoData.get(repo);
    const totalCommits = data?.commits.length ?? 0;
    const paddedName = repo.padEnd(maxRepoLen);

    if (totalCommits === 0) {
      return {
        name: dim(`${paddedName}   (no commits)`),
        value: NO_COMMITS_SENTINEL,
      };
    }

    const sp = splitPoints.get(repo);
    if (!sp) {
      return {
        name: `${paddedName}   not set`,
        value: repo,
      };
    }

    const shortSha = sp.commitSha.slice(0, 7);
    const commits = data?.commits ?? [];
    const extracted = countExtracted(commits, sp.commitSha, direction);
    const dirLabel = direction === "prefix" ? `ending with ${shortSha}` : `starting with ${shortSha}`;
    const unit = totalCommits === 1 ? "commit" : "commits";
    return {
      name: `${paddedName}   ${dirLabel} (${extracted} of ${totalCommits} ${unit})`,
      value: repo,
    };
  });

  return [...repoChoices, new Separator(), { name: "Confirm selection", value: CONFIRM_SENTINEL }];
}

/**
 * Count how many commits are extracted given a boundary SHA.
 * Commits are ordered newest-first.
 */
function countExtracted(commits: { fullHash: string }[], boundarySha: string, direction: "prefix" | "suffix"): number {
  const idx = commits.findIndex((c) => c.fullHash === boundarySha);
  if (idx === -1) return 0;

  if (direction === "prefix") {
    // Boundary and everything older (higher index) is extracted
    return commits.length - idx;
  }
  // Suffix: boundary and everything newer (lower index) is extracted
  return idx + 1;
}
