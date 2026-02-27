import { basename } from "node:path";
import { debugGit, isDebug } from "./debug";
import { git } from "./git";
import { dim, error, plural } from "./output";
import type { RepoRemotes } from "./remotes";
import { isTTY } from "./tty";

export interface FetchResult {
	repo: string;
	exitCode: number;
	output: string;
}

export async function parallelFetch(
	repoDirs: string[],
	timeout?: number,
	remotesMap?: Map<string, RepoRemotes>,
	options?: { silent?: boolean },
): Promise<Map<string, FetchResult>> {
	const fetchTimeout = timeout ?? (Number(process.env.ARB_FETCH_TIMEOUT) || 120);
	const results = new Map<string, FetchResult>();
	const total = repoDirs.length;

	if (total === 0) return results;

	const startTime = performance.now();
	let completed = 0;
	const tty = isTTY();
	const silent = options?.silent === true;
	const label = plural(total, "repo");

	const updateProgress = () => {
		if (tty && !silent) {
			const counter = completed > 0 ? ` ${completed}/${total}` : "";
			process.stderr.write(`\r\x1B[2KFetching ${label}...${counter}`);
		}
	};

	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	if (fetchTimeout > 0) {
		timeoutId = setTimeout(() => controller.abort(), fetchTimeout * 1000);
	}

	const fetchOne = async (repoDir: string): Promise<void> => {
		const repo = basename(repoDir);
		try {
			// Determine which remotes to fetch
			const repoRemotes = remotesMap?.get(repo);
			const remotesToFetch = new Set<string>();
			if (repoRemotes) {
				remotesToFetch.add(repoRemotes.base);
				remotesToFetch.add(repoRemotes.share);
			}
			const baseRemote = repoRemotes?.base;

			let allOutput = "";
			let lastExitCode = 0;

			if (remotesToFetch.size > 0) {
				for (const remote of remotesToFetch) {
					const fetchStart = isDebug() ? performance.now() : 0;
					const proc = Bun.spawn(["git", "-C", repoDir, "fetch", "--prune", remote], {
						cwd: repoDir,
						stdout: "pipe",
						stderr: "pipe",
					});

					// Race fetch against abort
					const abortPromise = new Promise<"aborted">((resolve) => {
						controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
					});

					const raceResult = await Promise.race([proc.exited, abortPromise]);

					if (raceResult === "aborted") {
						proc.kill();
						await proc.exited;
						if (isDebug()) {
							debugGit(`git -C ${repoDir} fetch --prune ${remote}`, performance.now() - fetchStart, 124);
						}
						results.set(repo, { repo, exitCode: 124, output: `fetch timed out after ${fetchTimeout}s` });
						completed++;
						updateProgress();
						return;
					}

					if (isDebug()) {
						debugGit(`git -C ${repoDir} fetch --prune ${remote}`, performance.now() - fetchStart, raceResult);
					}

					const stderrText = await new Response(proc.stderr).text();
					if (stderrText.trim()) {
						allOutput += (allOutput ? "\n" : "") + stderrText.trim();
					}
					if (raceResult !== 0) {
						lastExitCode = raceResult;
					}
				}
			} else {
				// No resolved remotes — fetch all
				const fetchAllStart = isDebug() ? performance.now() : 0;
				const proc = Bun.spawn(["git", "-C", repoDir, "fetch", "--all", "--prune"], {
					cwd: repoDir,
					stdout: "pipe",
					stderr: "pipe",
				});

				const abortPromise = new Promise<"aborted">((resolve) => {
					controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
				});

				const raceResult = await Promise.race([proc.exited, abortPromise]);

				if (raceResult === "aborted") {
					proc.kill();
					await proc.exited;
					if (isDebug()) {
						debugGit(`git -C ${repoDir} fetch --all --prune`, performance.now() - fetchAllStart, 124);
					}
					results.set(repo, { repo, exitCode: 124, output: `fetch timed out after ${fetchTimeout}s` });
					completed++;
					updateProgress();
					return;
				}

				if (isDebug()) {
					debugGit(`git -C ${repoDir} fetch --all --prune`, performance.now() - fetchAllStart, raceResult);
				}

				const stderrText = await new Response(proc.stderr).text();
				if (stderrText.trim()) {
					allOutput += stderrText.trim();
				}
				if (raceResult !== 0) {
					lastExitCode = raceResult;
				}
			}

			results.set(repo, { repo, exitCode: lastExitCode, output: allOutput });

			// Auto-detect remote HEAD on the base remote (only when we know which remote is base)
			if (baseRemote) {
				await git(repoDir, "remote", "set-head", baseRemote, "--auto");
			}
		} catch {
			results.set(repo, { repo, exitCode: 1, output: "fetch failed" });
		}
		completed++;
		updateProgress();
	};

	updateProgress();
	await Promise.all(repoDirs.map(fetchOne));

	if (timeoutId !== undefined) clearTimeout(timeoutId);

	const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
	if (!silent) {
		if (tty) {
			process.stderr.write(`\r\x1B[2KFetched ${label} in ${elapsed}s\n`);
		} else {
			process.stderr.write(`Fetched ${label} in ${elapsed}s\n`);
		}
	}

	return results;
}

export function reportFetchFailures(
	repos: string[],
	results: Map<string, { exitCode: number; output: string }>,
): string[] {
	const failed = getFetchFailedRepos(repos, results);
	for (const repo of failed) {
		const fr = results.get(repo);
		if (fr?.exitCode === 124) {
			error(`  [${repo}] fetch timed out`);
		} else {
			error(`  [${repo}] fetch failed`);
		}
		if (fr?.output) {
			for (const line of fr.output.split("\n").filter(Boolean)) {
				error(`    ${line}`);
			}
		}
	}
	return failed;
}

export function fetchSuffix(count: number): string {
	return dim(`Fetching ${plural(count, "repo")}...`);
}

export function getFetchFailedRepos(
	repos: string[],
	results: Map<string, { exitCode: number; output: string }>,
): string[] {
	return repos.filter((repo) => {
		const fr = results.get(repo);
		return !fr || fr.exitCode !== 0;
	});
}
