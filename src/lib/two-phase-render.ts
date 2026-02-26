import { clearLines, countLines, dim, plural, stderr } from "./output";
import { type FetchResult, getFetchFailedRepos, parallelFetch, reportFetchFailures } from "./parallel-fetch";
import type { RepoRemotes } from "./remotes";

export interface TwoPhaseRenderOptions<T> {
	fetchDirs: string[];
	remotesMap: Map<string, RepoRemotes>;
	reposForFetchReport: string[];
	/** Gather data. Called twice: once with stale refs, once after fetch. */
	gather: (fetchFailed: string[]) => Promise<T>;
	/** Format gathered data into a displayable string. May be async. */
	format: (data: T) => string | Promise<string>;
	/** Where to write stale output (default: stderr) */
	writeStale?: (output: string) => void;
	/** Where to write fresh output (default: stderr) */
	writeFresh?: (output: string) => void;
}

export async function runTwoPhaseRender<T>(
	options: TwoPhaseRenderOptions<T>,
): Promise<{ data: T; fetchFailed: string[] }> {
	const writeStale = options.writeStale ?? stderr;
	const writeFresh = options.writeFresh ?? stderr;

	const fetchPromise = parallelFetch(options.fetchDirs, undefined, options.remotesMap, { silent: true });

	// Phase 1: gather and render stale output
	let data = await options.gather([]);
	const staleFormatted = await options.format(data);
	const fetchingLine = dim(`Fetching ${plural(options.fetchDirs.length, "repo")}...`);
	const staleOutput = staleFormatted + fetchingLine;
	writeStale(staleOutput);

	// Await fetch
	const fetchResults: Map<string, FetchResult> = await fetchPromise;
	const fetchFailed = getFetchFailedRepos(options.reposForFetchReport, fetchResults);

	// Phase 2: gather and render fresh output
	data = await options.gather(fetchFailed);
	const freshFormatted = await options.format(data);
	process.stderr.write("\r"); // return to column 0 before clearing
	clearLines(countLines(staleOutput));
	writeFresh(freshFormatted);

	reportFetchFailures(options.reposForFetchReport, fetchResults);
	return { data, fetchFailed };
}
