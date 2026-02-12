import { basename } from "node:path";
import { error } from "./output";
import { isTTY } from "./tty";

export interface FetchResult {
	repo: string;
	exitCode: number;
	output: string;
}

export async function parallelFetch(repoDirs: string[], timeout?: number): Promise<Map<string, FetchResult>> {
	const fetchTimeout = timeout ?? (Number(process.env.ARB_FETCH_TIMEOUT) || 120);
	const results = new Map<string, FetchResult>();
	const total = repoDirs.length;

	if (total === 0) return results;

	let completed = 0;
	const showProgress = isTTY() && total > 0;

	const updateProgress = () => {
		if (showProgress) {
			process.stderr.write(`\r  Fetched ${completed}/${total}`);
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
			const proc = Bun.spawn(["git", "-C", repoDir, "fetch", "origin"], {
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
				results.set(repo, { repo, exitCode: 124, output: `fetch timed out after ${fetchTimeout}s` });
			} else {
				const stderrText = await new Response(proc.stderr).text();
				results.set(repo, { repo, exitCode: raceResult, output: stderrText.trim() });
			}

			// Auto-detect remote HEAD
			await Bun.$`git -C ${repoDir} remote set-head origin --auto`.quiet().nothrow();
		} catch {
			results.set(repo, { repo, exitCode: 1, output: "fetch failed" });
		}
		completed++;
		updateProgress();
	};

	updateProgress();
	await Promise.all(repoDirs.map(fetchOne));

	if (timeoutId !== undefined) clearTimeout(timeoutId);

	if (showProgress) {
		process.stderr.write(`\r${" ".repeat(40)}\r`);
	}

	return results;
}

export function reportFetchFailures(
	repos: string[],
	localRepos: string[],
	results: Map<string, { exitCode: number; output: string }>,
): string[] {
	const failed = repos
		.filter((repo) => !localRepos.includes(repo))
		.filter((repo) => {
			const fr = results.get(repo);
			if (fr && fr.exitCode === 0) return false;
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
			return true;
		});
	return failed;
}
