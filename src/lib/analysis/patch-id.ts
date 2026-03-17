import { localTimeout } from "../git/git";
import { debugGit, isDebug } from "../terminal/debug";

/** Parse `"patchId hash\n"` output into a Map<patchId, commitHash>. */
export function parsePatchIdOutput(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [patchId, hash] = line.split(" ");
    if (patchId && hash) map.set(patchId, hash);
  }
  return map;
}

/** Race a Bun.$ shell promise against localTimeout(). Returns null on timeout. */
async function raceShellTimeout<T>(shellPromise: Promise<T>): Promise<T | null> {
  const timeout = localTimeout();
  if (timeout <= 0) return shellPromise;
  const race = await Promise.race([
    shellPromise.then((r) => ({ kind: "done" as const, r })),
    new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), timeout * 1000)),
  ]);
  return race.kind === "timeout" ? null : race.r;
}

/**
 * Per-commit patch-ids via `git log -p FROM..TO | git patch-id --stable`.
 * Pass `maxCount` to limit how many commits are processed.
 * Returns a Map<patchId, commitHash>, or null on failure.
 */
export async function computePatchIds(
  repoDir: string,
  from: string,
  to: string,
  maxCount?: number,
): Promise<Map<string, string> | null> {
  const start = isDebug() ? performance.now() : 0;
  const maxCountArgs = maxCount !== undefined ? [`--max-count=${maxCount}`] : [];
  const result = await raceShellTimeout(
    Bun.$`git -C ${repoDir} log -p ${maxCountArgs} ${from}..${to} | git patch-id --stable`.quiet().nothrow(),
  );
  if (result === null) {
    if (isDebug()) {
      debugGit(`git -C ${repoDir} log -p ${from}..${to} | git patch-id --stable`, performance.now() - start, 124);
    }
    return null;
  }
  if (isDebug()) {
    const cmd =
      maxCount !== undefined
        ? `git -C ${repoDir} log -p --max-count=${maxCount} ${from}..${to} | git patch-id --stable`
        : `git -C ${repoDir} log -p ${from}..${to} | git patch-id --stable`;
    debugGit(cmd, performance.now() - start, result.exitCode);
  }
  if (result.exitCode !== 0) return null;
  return parsePatchIdOutput(result.text());
}

/**
 * Cumulative range patch-id via `git diff FROM..TO | git patch-id --stable`.
 * Returns the patch-id string, or null on failure / empty diff.
 */
export async function computeCumulativePatchId(repoDir: string, from: string, to: string): Promise<string | null> {
  const start = isDebug() ? performance.now() : 0;
  const result = await raceShellTimeout(
    Bun.$`git -C ${repoDir} diff ${from}..${to} | git patch-id --stable`.quiet().nothrow(),
  );
  if (result === null) {
    if (isDebug()) {
      debugGit(`git -C ${repoDir} diff ${from}..${to} | git patch-id --stable`, performance.now() - start, 124);
    }
    return null;
  }
  if (isDebug()) {
    debugGit(
      `git -C ${repoDir} diff ${from}..${to} | git patch-id --stable`,
      performance.now() - start,
      result.exitCode,
    );
  }
  if (result.exitCode !== 0) return null;
  const patchId = result.text().trim().split(" ")[0];
  return patchId || null;
}

/**
 * Cumulative patch-id for a single commit via `git diff-tree -p HASH | git patch-id --stable`.
 * Returns the patch-id string, or null on failure.
 */
export async function computeDiffTreePatchId(repoDir: string, hash: string): Promise<string | null> {
  const result = await raceShellTimeout(
    Bun.$`git -C ${repoDir} diff-tree -p ${hash} | git patch-id --stable`.quiet().nothrow(),
  );
  if (result === null) return null;
  if (result.exitCode !== 0) return null;
  const patchId = result.text().trim().split(" ")[0];
  return patchId || null;
}

/**
 * Cross-match two patch-id maps. Returns a Map<hashB, hashA> for each matching patchId.
 */
export function crossMatchPatchIds(mapA: Map<string, string>, mapB: Map<string, string>): Map<string, string> {
  const result = new Map<string, string>();
  const aPatchIds = new Set(mapA.keys());
  for (const [patchId, hashB] of mapB) {
    if (aPatchIds.has(patchId)) {
      const hashA = mapA.get(patchId);
      if (hashA) result.set(hashB, hashA);
    }
  }
  return result;
}
