/** Regex matching Jira/Linear-style ticket keys: PROJ-123, ACME-208, etc. */
const TICKET_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/gi;

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
 *
 * Used by PR detection as a fallback: when no merge commit is found via branch name,
 * the extracted ticket key is used to search for commits referencing the ticket.
 */
export function detectTicketFromName(name: string): string | null {
  const matches = name.match(TICKET_PATTERN);
  if (!matches) return null;
  const valid = matches.find(isTicketCandidate);
  return valid?.toUpperCase() ?? null;
}
