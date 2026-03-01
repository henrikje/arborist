import { git } from "./git";

/** Regex matching Jira/Linear-style ticket keys: PROJ-123, ACME-208, etc. */
const TICKET_PATTERN = /[A-Z][A-Z0-9]+-\d+/gi;

/**
 * Prefixes that structurally cannot be ticket project keys.
 * PR = Pull Request, MR = Merge Request — these appear in branch names
 * to reference code review artifacts, not issue tracker tickets.
 */
const NON_TICKET_PREFIXES = new Set(["PR", "MR"]);

function isTicketCandidate(match: string): boolean {
	const prefix = match.split("-")[0]?.toUpperCase();
	return prefix != null && !NON_TICKET_PREFIXES.has(prefix);
}

/**
 * Extract a ticket key from a branch name.
 * Looks for patterns like PROJ-208, ACME-42, etc. (case-insensitive, returned uppercased).
 * Returns the first match or null.
 */
export function detectTicketFromName(name: string): string | null {
	const matches = name.match(TICKET_PATTERN);
	if (!matches) return null;
	const valid = matches.find(isTicketCandidate);
	return valid?.toUpperCase() ?? null;
}

/**
 * Scan commit messages in the range `baseRef..HEAD` for ticket keys.
 * Returns the most frequently occurring key, or null if none found.
 */
export async function detectTicketFromCommits(repoDir: string, baseRef: string): Promise<string | null> {
	const result = await git(repoDir, "log", "--format=%B", "--max-count=200", `${baseRef}..HEAD`);
	if (result.exitCode !== 0 || !result.stdout.trim()) return null;

	const counts = new Map<string, number>();
	for (const match of result.stdout.matchAll(TICKET_PATTERN)) {
		const key = match[0].toUpperCase();
		if (!isTicketCandidate(key)) continue;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	if (counts.size === 0) return null;

	// Return the most frequent key
	let best: string | null = null;
	let bestCount = 0;
	for (const [key, count] of counts) {
		if (count > bestCount) {
			best = key;
			bestCount = count;
		}
	}
	return best;
}
