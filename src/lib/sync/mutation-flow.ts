import confirm from "@inquirer/confirm";
import { ArbAbort, ArbError } from "../core/errors";
import type { RepoRemotes } from "../git/remotes";
import { runPhasedRender } from "../render/phased-render";
import { error, skipConfirmNotice, stderr } from "../terminal/output";
import { isTTY } from "../terminal/tty";
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
  fetchDirs: string[];
  reposForFetchReport: string[];
  remotesMap: Map<string, RepoRemotes>;
  assess: (fetchFailed: string[], unchangedRepos: Set<string>) => Promise<TAssessment[]>;
  postAssess?: (assessments: TAssessment[]) => Promise<void>;
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
    await options.postAssess(assessments);
  }
  return assessments;
}

export async function runPlanFlow<TAssessment>(options: PlanFlowOptions<TAssessment>): Promise<TAssessment[]> {
  const shouldFetch = options.shouldFetch !== false;
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
    return state.assessments as TAssessment[];
  }

  if (shouldFetch && options.fetchDirs.length > 0) {
    const fetchResults = await parallelFetch(options.fetchDirs, undefined, options.remotesMap);
    options.onPostFetch?.();
    const fetchFailed = reportFetchFailures(options.reposForFetchReport, fetchResults);
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
