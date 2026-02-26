import confirm from "@inquirer/confirm";
import { ArbAbort, ArbError } from "./errors";
import { error, skipConfirmNotice, stderr } from "./output";
import { parallelFetch, reportFetchFailures } from "./parallel-fetch";
import type { RepoRemotes } from "./remotes";
import { isTTY } from "./tty";
import { runTwoPhaseRender } from "./two-phase-render";

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
		const { data } = await runTwoPhaseRender({
			fetchDirs: options.fetchDirs,
			remotesMap: options.remotesMap,
			reposForFetchReport: options.reposForFetchReport,
			gather: (fetchFailed) => assessWithPost(options, fetchFailed),
			format: (assessments) => options.formatPlan(assessments),
		});
		return data;
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
			throw new ArbError("Not a terminal. Use --yes to skip confirmation.");
		}
		const ok = await confirm(
			{
				message: options.message,
				default: false,
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
