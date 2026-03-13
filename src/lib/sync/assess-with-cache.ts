import type { GitCache } from "../git/git-cache";
import type { RepoRemotes } from "../git/remotes";
import { computeFlags } from "../status/flags";
import { gatherRepoStatus } from "../status/status";
import { repoMatchesWhere } from "../status/where";

interface BuildCachedStatusAssessOptions<TAssessment> {
  repos: string[];
  wsDir: string;
  reposDir: string;
  branch: string;
  configBase: string | null;
  remotesMap: Map<string, RepoRemotes>;
  cache: GitCache;
  where?: string;
  classify: (input: {
    repo: string;
    repoDir: string;
    status: Awaited<ReturnType<typeof gatherRepoStatus>>;
    fetchFailed: string[];
  }) => Promise<TAssessment | null> | TAssessment | null;
}

export function buildCachedStatusAssess<TAssessment>(options: BuildCachedStatusAssessOptions<TAssessment>) {
  const prevStatuses = new Map<string, Awaited<ReturnType<typeof gatherRepoStatus>>>();

  return async (fetchFailed: string[], unchangedRepos: Set<string>): Promise<TAssessment[]> => {
    const assessments = await Promise.all(
      options.repos.map(async (repo) => {
        const repoDir = `${options.wsDir}/${repo}`;
        let status = prevStatuses.get(repo);
        if (!(unchangedRepos.has(repo) && status)) {
          status = await gatherRepoStatus(
            repoDir,
            options.reposDir,
            options.configBase,
            options.remotesMap.get(repo),
            options.cache,
          );
          prevStatuses.set(repo, status);
        }
        if (options.where) {
          const flags = computeFlags(status, options.branch);
          if (!repoMatchesWhere(flags, options.where)) return null;
        }
        return options.classify({ repo, repoDir, status, fetchFailed });
      }),
    );

    return assessments.filter((assessment) => assessment !== null) as TAssessment[];
  };
}
