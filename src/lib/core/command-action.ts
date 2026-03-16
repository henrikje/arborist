/**
 * Centralized command action wrapper.
 *
 * Provides `arbAction()` — a wrapper for command action handlers that
 * automatically resolves the arb project context, creates a GitCache,
 * loads the analysis cache, and saves it on completion.
 *
 * Commands that don't need a project context (init, help) use a plain
 * action handler without the wrapper — an explicit opt-out.
 */

import { assertMinimumGitVersion } from "../git/git";
import { GitCache } from "../git/git-cache";
import { AnalysisCache } from "../status/analysis-cache";
import { error } from "../terminal/output";
import { detectArbRoot, detectWorkspace } from "../workspace/arb-root";
import { ArbError } from "./errors";
import type { ArbContext } from "./types";

export interface CommandContext extends ArbContext {
  cache: GitCache;
  analysisCache: AnalysisCache;
}

/**
 * Wrap a command action handler with automatic project context resolution,
 * cache creation, and cache saving.
 *
 * The wrapped function receives a `CommandContext` as its first argument,
 * followed by Commander's normal positional args, options, and command.
 *
 * Commands that don't need a project context (init, help) should NOT use
 * this wrapper — their plain `.action()` handler is the explicit opt-out.
 */
// Commander.js action callbacks are inherently untyped — `any` is the correct boundary type here.
// biome-ignore lint/suspicious/noExplicitAny: Commander interop
type ActionFn = (ctx: CommandContext, ...args: any[]) => Promise<void>;
// biome-ignore lint/suspicious/noExplicitAny: Commander interop
type ActionHandler = (...args: any[]) => Promise<void>;

export function arbAction(fn: ActionFn): ActionHandler {
  return async (...args) => {
    const arbRootDir = detectArbRoot();
    if (!arbRootDir) {
      error("Not inside a project. Run 'arb init' to set one up.");
      throw new ArbError("Not inside a project. Run 'arb init' to set one up.");
    }
    const cache = new GitCache();
    await assertMinimumGitVersion(cache);
    const analysisCache = AnalysisCache.load(arbRootDir);
    const ctx: CommandContext = {
      arbRootDir,
      reposDir: `${arbRootDir}/.arb/repos`,
      currentWorkspace: detectWorkspace(arbRootDir),
      cache,
      analysisCache,
    };
    try {
      await fn(ctx, ...args);
    } finally {
      analysisCache.save();
    }
  };
}
