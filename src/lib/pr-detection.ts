/** Extract PR/MR numbers from commit subjects — pure functions, no I/O. */

/**
 * Extract a PR number from a commit subject line.
 *
 * Recognized patterns:
 * - `(#N)` — GitHub squash merge default suffix
 * - `Merge pull request #N` — GitHub merge commit
 * - `Merged PR N:` — Azure DevOps merge commit
 *
 * Returns the PR number or null if no pattern matches.
 */
export function extractPrNumber(commitSubject: string): number | null {
	// GitHub merge commit: "Merge pull request #123 from user/branch"
	const ghMerge = commitSubject.match(/^Merge pull request #(\d+)\b/);
	if (ghMerge?.[1]) return Number.parseInt(ghMerge[1], 10);

	// Azure DevOps merge commit: "Merged PR 123: Title"
	const adoMerge = commitSubject.match(/^Merged PR (\d+):/);
	if (adoMerge?.[1]) return Number.parseInt(adoMerge[1], 10);

	// GitHub squash merge: "Title (#123)"
	const ghSquash = commitSubject.match(/\(#(\d+)\)\s*$/);
	if (ghSquash?.[1]) return Number.parseInt(ghSquash[1], 10);

	return null;
}
