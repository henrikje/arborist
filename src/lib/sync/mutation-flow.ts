import confirm from "@inquirer/confirm";
import { ArbAbort, ArbError } from "../core/errors";
import type { RepoRemotes } from "../git/remotes";
import { runPhasedRender } from "../render/phased-render";
import { error, skipConfirmNotice, stderr } from "../terminal/output";
import { isTTY } from "../terminal/tty";
import {
  allReposFresh,
  fetchTtl,
  loadFetchTimestamps,
  recordFetchResults,
  saveFetchTimestamps,
} from "./fetch-freshness";
import {
  type FetchResult,
  fetchSuffix,
  getFetchFailedRepos,
  getUnchangedRepos,
  parallelFetch,
  reportFetchFailures,
} from "./parallel-fetch";

export interface PlanFlowOptions<TAssessment> {
  shouldFetch?: boolean;
  forceFetch?: boolean;
  arbRootDir?: string;
  fetchDirs: string[];
  reposForFetchReport: string[];
  remotesMap: Map<string, RepoRemotes>;
  assess: (fetchFailed: string[], unchangedRepos: Set<string>) => Promise<TAssessment[]>;
  postAssess?: (assessments: TAssessment[]) => Promise<TAssessment[]>;
  formatPlan: (assessments: TAssessment[]) => string;
  onPostFetch?: () => void;
}

async function assessWithPost<TAssessment>(
  options: PlanFlowOptions<TAssessment>,
  fetchFailed: string[],
  unchangedRepos: Set<string>,
): Promise<TAssessment[]> {
  const assessments = await options.assess(fetchFailed, unchangedRepos);
  if (options.postAssess) {
    return options.postAssess(assessments);
  }
  return assessments;
}

export async function runPlanFlow<TAssessment>(options: PlanFlowOptions<TAssessment>): Promise<TAssessment[]> {
  const fetchTimestamps = options.arbRootDir ? loadFetchTimestamps(options.arbRootDir) : undefined;
  const wantsFetch = options.shouldFetch !== false;
  const shouldFetch =
    wantsFetch &&
    (options.forceFetch === true ||
      !fetchTimestamps ||
      !allReposFresh(options.reposForFetchReport, fetchTimestamps, fetchTtl()));
  const canPhase = shouldFetch && options.fetchDirs.length > 0 && isTTY();

  const emptySet = new Set<string>();

  if (canPhase) {
    const fetchPromise = parallelFetch(options.fetchDirs, undefined, options.remotesMap, { silent: true });
    const state: { assessments?: TAssessment[]; fetchResults?: Map<string, FetchResult> } = {};
    await runPhasedRender([
      {
        render: async () => {
          state.assessments = await assessWithPost(options, [], emptySet);
          return options.formatPlan(state.assessments) + fetchSuffix(options.fetchDirs.length);
        },
      },
      {
        render: async () => {
          state.fetchResults = await fetchPromise;
          options.onPostFetch?.();
          const ff = getFetchFailedRepos(options.reposForFetchReport, state.fetchResults);
          const unchanged = getUnchangedRepos(state.fetchResults);
          state.assessments = await assessWithPost(options, ff, unchanged);
          return options.formatPlan(state.assessments);
        },
      },
    ]);
    reportFetchFailures(options.reposForFetchReport, state.fetchResults as Map<string, FetchResult>);
    if (fetchTimestamps && options.arbRootDir) {
      recordFetchResults(fetchTimestamps, state.fetchResults as Map<string, FetchResult>);
      saveFetchTimestamps(options.arbRootDir, fetchTimestamps);
    }
    return state.assessments as TAssessment[];
  }

  if (shouldFetch && options.fetchDirs.length > 0) {
    const fetchResults = await parallelFetch(options.fetchDirs, undefined, options.remotesMap);
    options.onPostFetch?.();
    const fetchFailed = reportFetchFailures(options.reposForFetchReport, fetchResults);
    if (fetchTimestamps && options.arbRootDir) {
      recordFetchResults(fetchTimestamps, fetchResults);
      saveFetchTimestamps(options.arbRootDir, fetchTimestamps);
    }
    const assessments = await assessWithPost(options, fetchFailed, emptySet);
    stderr(options.formatPlan(assessments));
    return assessments;
  }

  const assessments = await assessWithPost(options, [], emptySet);
  stderr(options.formatPlan(assessments));
  return assessments;
}

export async function confirmOrExit(options: {
  yes?: boolean;
  message: string;
  skipFlag?: string;
}): Promise<void> {
  if (!options.yes) {
    if (!isTTY() || !process.stdin.isTTY) {
      error("Not a terminal. Use --yes to skip confirmation.");
      throw new ArbError("Not a terminal. Use --yes to skip confirmation.");
    }
    const ok = await confirm(
      {
        message: options.message,
        default: true,
      },
      { output: process.stderr },
    );
    if (!ok) {
      throw new ArbAbort();
    }
    return;
  }
  skipConfirmNotice(options.skipFlag ?? "--yes");
}
