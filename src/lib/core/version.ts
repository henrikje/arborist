// ── Build-time version stamping ──
//
// Pure logic for constructing version strings. Used by scripts/set-version.ts
// at build time. Extracted here so the decision logic is unit-testable.

/** Inputs gathered from git and the environment. */
export interface VersionInputs {
  /** Git tag on HEAD matching `v*`, or null if untagged. */
  tag: string | null;
  /** Whether the working tree has uncommitted changes. */
  dirty: boolean;
  /** Short git SHA of HEAD. */
  sha: string;
  /** ISO 8601 build timestamp. */
  buildTime: string;
}

export interface VersionResult {
  /** The full version string to embed. */
  version: string;
  /** Whether this is a release build (clean tag). */
  isRelease: boolean;
}

const UNSAFE_FILENAME_CHARS = /[:/\\]/;

/**
 * Build a version string from git state.
 *
 * - Clean tag:  `1.2.3` (release)
 * - Dirty tag:  `dev.<sha>.dirty.<timestamp>` (dev)
 * - No tag:     `dev.<sha>.<timestamp>` or `dev.<sha>.dirty.<timestamp>` (dev)
 */
export function buildVersion(inputs: VersionInputs): VersionResult {
  const { tag, dirty, sha, buildTime } = inputs;

  let version: string;
  let isRelease = false;

  if (tag !== null) {
    if (!dirty) {
      version = tag.replace(/^v/, "");
      isRelease = true;
    } else {
      version = `dev.${sha}.dirty`;
    }
  } else {
    version = dirty ? `dev.${sha}.dirty` : `dev.${sha}`;
  }

  if (!isRelease) {
    version = `${version}.${buildTime}`;
  }

  return { version, isRelease };
}

/**
 * Returns an error message if the version is not safe for use in filenames
 * and artifact paths, or null if valid.
 */
export function validateVersionForFilename(version: string): string | null {
  if (UNSAFE_FILENAME_CHARS.test(version)) {
    const bad = version.match(UNSAFE_FILENAME_CHARS)?.[0];
    return `Version "${version}" contains filesystem-unsafe character: ${JSON.stringify(bad)}`;
  }
  return null;
}
