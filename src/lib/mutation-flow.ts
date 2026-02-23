import confirm from "@inquirer/confirm";
import { clearLines, countLines, dim, error, plural, skipConfirmNotice, stderr } from "./output";
import { getFetchFailedRepos, parallelFetch, reportFetchFailures } from "./parallel-fetch";
import type { RepoRemotes } from "./remotes";
import { isTTY } from "./tty";

export interface PlanFlowOptions<TAssessment> {
	shouldFetch?: boolean;
	fetchDirs: string[];
	reposForFetchReport: string[];
	remotesMap: Map<string, RepoRemotes>;
	assess: (fetchFailed: string[]) => Promise<TAssessment[]>;
	postAssess?: (assessments: TAssessment[]) => Promise<void>;
	formatPlan: (assessments: TAssessment[]) => string;
}

async function assessWithPost<TAssessment>(
	options: PlanFlowOptions<TAssessment>,
	fetchFailed: string[],
): Promise<TAssessment[]> {
	const assessments = await options.assess(fetchFailed);
	if (options.postAssess) {
		await options.postAssess(assessments);
	}
	return assessments;
}

export async function runPlanFlow<TAssessment>(options: PlanFlowOptions<TAssessment>): Promise<TAssessment[]> {
	const shouldFetch = options.shouldFetch !== false;
	const canTwoPhase = shouldFetch && options.fetchDirs.length > 0 && isTTY();

	if (canTwoPhase) {
		const fetchPromise = parallelFetch(options.fetchDirs, undefined, options.remotesMap, { silent: true });

		let assessments = await assessWithPost(options, []);
		const stalePlan = options.formatPlan(assessments);
		const fetchingLine = `${dim(`Fetching ${plural(options.fetchDirs.length, "repo")}...`)}\n`;
		const staleOutput = stalePlan + fetchingLine;
		stderr(staleOutput);

		const fetchResults = await fetchPromise;
		const fetchFailed = getFetchFailedRepos(options.reposForFetchReport, fetchResults);

		assessments = await assessWithPost(options, fetchFailed);
		const freshPlan = options.formatPlan(assessments);
		clearLines(countLines(staleOutput));
		stderr(freshPlan);

		reportFetchFailures(options.reposForFetchReport, fetchResults);
		return assessments;
	}

	if (shouldFetch && options.fetchDirs.length > 0) {
		const fetchResults = await parallelFetch(options.fetchDirs, undefined, options.remotesMap);
		const fetchFailed = reportFetchFailures(options.reposForFetchReport, fetchResults);
		const assessments = await assessWithPost(options, fetchFailed);
		stderr(options.formatPlan(assessments));
		return assessments;
	}

	const assessments = await assessWithPost(options, []);
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
			process.exit(1);
		}
		const ok = await confirm(
			{
				message: options.message,
				default: false,
			},
			{ output: process.stderr },
		);
		if (!ok) {
			process.stderr.write("Aborted.\n");
			process.exit(130);
		}
		return;
	}
	skipConfirmNotice(options.skipFlag ?? "--yes");
}
