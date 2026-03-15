import { ArbError } from "../core/errors";
import { parseDuration } from "../core/time";
import { error } from "../terminal/output";
import { computeFlags, isAtRisk } from "./flags";
import { type AgeFilter, type RepoFlags, type RepoStatus, STALE_FLAGS } from "./types";

function hasAnyFlag(flags: RepoFlags, set: Set<keyof RepoFlags>): boolean {
  for (const key of set) {
    if (flags[key]) return true;
  }
  return false;
}

// ── Where Filtering ──

const FILTER_TERMS: Record<string, (f: RepoFlags) => boolean> = {
  // Negative / problem-condition terms
  dirty: (f) => f.isDirty,
  unpushed: (f) => f.isUnpushed,
  "behind-share": (f) => f.needsPull,
  "behind-base": (f) => f.needsRebase,
  diverged: (f) => f.isDiverged,
  "wrong-branch": (f) => f.isWrongBranch,
  detached: (f) => f.isDetached,
  operation: (f) => f.hasOperation,
  gone: (f) => f.isGone,
  shallow: (f) => f.isShallow,
  merged: (f) => f.isMerged,
  "base-merged": (f) => f.isBaseMerged,
  "base-missing": (f) => f.isBaseMissing,
  "at-risk": (f) => isAtRisk(f),
  stale: (f) => hasAnyFlag(f, STALE_FLAGS),
  // Positive / healthy-state terms
  clean: (f) => !f.isDirty,
  pushed: (f) => !f.isUnpushed,
  "synced-base": (f) => !f.needsRebase && !f.isDiverged,
  "synced-share": (f) => !f.needsPull,
  synced: (f) => !hasAnyFlag(f, STALE_FLAGS),
  safe: (f) => !isAtRisk(f),
};

const VALID_TERMS = Object.keys(FILTER_TERMS);

/** Strip a leading `^` negation prefix, returning the base term and whether it was negated. */
function parseNegation(term: string): { base: string; negated: boolean } {
  if (term.startsWith("^")) return { base: term.slice(1), negated: true };
  return { base: term, negated: false };
}

export function validateWhere(where: string): string | null {
  const groups = where.split(",");
  const allTerms = groups.flatMap((g) => g.split("+"));
  const invalid = allTerms.filter((t) => !FILTER_TERMS[parseNegation(t).base]);
  if (invalid.length > 0) {
    return `Unknown filter ${invalid.length === 1 ? "term" : "terms"}: ${invalid.join(", ")}. Valid terms: ${VALID_TERMS.join(", ")} (prefix with ^ to negate)`;
  }
  return null;
}

export function resolveWhereFilter(options: { dirty?: boolean; where?: string }): string | undefined {
  if (options.dirty && options.where) {
    error("Cannot combine --dirty with --where. Use --where dirty,... instead.");
    throw new ArbError("Cannot combine --dirty with --where. Use --where dirty,... instead.");
  }
  const where = options.dirty ? "dirty" : options.where;
  if (where) {
    const err = validateWhere(where);
    if (err) {
      error(err);
      throw new ArbError(err);
    }
  }
  return where;
}

export function repoMatchesWhere(flags: RepoFlags, where: string): boolean {
  const groups = where.split(",");
  return groups.some((group) => {
    const terms = group.split("+");
    return terms.every((t) => {
      const { base, negated } = parseNegation(t);
      const result = FILTER_TERMS[base]?.(flags) ?? false;
      return negated ? !result : result;
    });
  });
}

export function workspaceMatchesWhere(repos: RepoStatus[], branch: string, where: string): boolean {
  return repos.some((repo) => {
    const flags = computeFlags(repo, branch);
    return repoMatchesWhere(flags, where);
  });
}

// ── Age Filtering ──

export function resolveAgeFilter(options: { olderThan?: string; newerThan?: string }): AgeFilter | undefined {
  const { olderThan, newerThan } = options;
  if (!olderThan && !newerThan) return undefined;
  const filter: AgeFilter = {};
  if (olderThan) {
    const ms = parseDuration(olderThan);
    if (ms === null) {
      error(
        `Invalid duration "${olderThan}". Use a positive integer followed by d (days), w (weeks), m (months), or y (years). Examples: 30d, 2w, 3m, 1y`,
      );
      throw new ArbError(
        `Invalid duration: ${olderThan}. Use a positive integer followed by d (days), w (weeks), m (months), or y (years). Examples: 30d, 2w, 3m, 1y`,
      );
    }
    filter.olderThan = ms;
  }
  if (newerThan) {
    const ms = parseDuration(newerThan);
    if (ms === null) {
      error(
        `Invalid duration "${newerThan}". Use a positive integer followed by d (days), w (weeks), m (months), or y (years). Examples: 30d, 2w, 3m, 1y`,
      );
      throw new ArbError(
        `Invalid duration: ${newerThan}. Use a positive integer followed by d (days), w (weeks), m (months), or y (years). Examples: 30d, 2w, 3m, 1y`,
      );
    }
    filter.newerThan = ms;
  }
  return filter;
}

/** Returns true if the given activity date (ISO string or null) matches the age filter.
 * null is treated as infinitely old: matches olderThan, does not match newerThan. */
export function matchesAge(activityDate: string | null, filter: AgeFilter): boolean {
  if (activityDate === null) {
    return filter.olderThan !== undefined;
  }
  const ageMs = Date.now() - new Date(activityDate).getTime();
  if (filter.olderThan !== undefined && ageMs <= filter.olderThan) return false;
  if (filter.newerThan !== undefined && ageMs >= filter.newerThan) return false;
  return true;
}
