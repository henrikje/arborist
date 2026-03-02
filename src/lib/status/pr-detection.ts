/** Extract PR/MR numbers from commit subjects — pure functions, no I/O. */

/**
 * Extract a PR number from a commit subject line.
 *
 * Recognized patterns (in priority order):
 * - `Merge pull request #N` — GitHub merge commit
 * - `Merged PR N:` — Azure DevOps merge commit
 * - `(pull request #N)` — Bitbucket merge commit
 * - `(#N)` — GitHub squash merge default suffix
 * - `(!N)` — GitLab squash/merge commit suffix
 *
 * Returns the PR number or null if no pattern matches.
 *
 * Note: GitLab default merge format ("Merge branch 'x' into 'y'") contains
 * no MR number and cannot be detected from git data alone.
 */
export function extractPrNumber(commitSubject: string): number | null {
	// GitHub merge commit: "Merge pull request #123 from user/branch"
	const ghMerge = commitSubject.match(/^Merge pull request #(\d+)\b/);
	if (ghMerge?.[1]) return Number.parseInt(ghMerge[1], 10);

	// Azure DevOps merge commit: "Merged PR 123: Title"
	const adoMerge = commitSubject.match(/^Merged PR (\d+):/);
	if (adoMerge?.[1]) return Number.parseInt(adoMerge[1], 10);

	// Bitbucket merge commit: "Merged in feature (pull request #42)"
	const bbMerge = commitSubject.match(/\(pull request #(\d+)\)/);
	if (bbMerge?.[1]) return Number.parseInt(bbMerge[1], 10);

	// GitHub squash merge: "Title (#123)"
	const ghSquash = commitSubject.match(/\(#(\d+)\)\s*$/);
	if (ghSquash?.[1]) return Number.parseInt(ghSquash[1], 10);

	// GitLab squash/merge commit: "feat: add feature (!42)"
	const glMerge = commitSubject.match(/\(!(\d+)\)\s*$/);
	if (glMerge?.[1]) return Number.parseInt(glMerge[1], 10);

	return null;
}
