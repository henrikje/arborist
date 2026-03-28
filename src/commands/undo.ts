import type { Command } from "commander";
import { ArbError, type OperationRecord, arbAction, deleteOperationRecord, readOperationRecord } from "../lib/core";
import { runUndoFlow } from "../lib/sync";
import { error, info, readNamesFromStdin } from "../lib/terminal";
import { requireWorkspace } from "../lib/workspace";

// ── Command registration ──

export function registerUndoCommand(program: Command): void {
  program
    .command("undo [repos...]")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show commits being rolled back in the plan")
    .option("-f, --force", "Force undo even when repos have drifted since the operation")
    .option("--discard", "Delete a corrupted operation record without attempting to undo")
    .summary("Undo the last workspace operation")
    .description(
      "Examples:\n\n  arb undo                                 Undo the last operation\n  arb undo api web                         Undo only specific repos\n  arb undo --verbose --dry-run             Preview what would be undone\n\nReverses the most recent workspace operation (branch rename, retarget, rebase, merge, or pull). Reads the operation record from .arbws/operation.json, shows what will be undone, and asks for confirmation.\n\nWhen called with [repos...], only the named repos are undone. The operation record tracks the partially-undone state, and you can undo additional repos later with another 'arb undo [repos...]'. A bare 'arb undo' without repo arguments undoes all remaining repos.\n\nFor branch renames: reverses the git branch -m and restores the workspace config.\nFor sync operations (rebase, merge, retarget): resets repos to their pre-operation HEAD and aborts any in-progress git operations.\n\nIf any selected repo has drifted (HEAD moved since the operation), undo is refused with an explanation. Use --force to override the drift check and force-reset drifted repos to their pre-operation state.\n\nUse --yes to skip the confirmation prompt. Use --verbose to show the individual commits that will be rolled back for each repo.\n\nUse --discard to delete a corrupted operation record without attempting to undo. This is an escape hatch when the record is unreadable.",
    )
    .action(
      arbAction(
        async (
          ctx,
          repoArgs: string[],
          options: { yes?: boolean; dryRun?: boolean; verbose?: boolean; force?: boolean; discard?: boolean },
        ) => {
          const { wsDir } = requireWorkspace(ctx);

          // Resolve repo names from args or stdin
          let repos = repoArgs;
          if (repos.length === 0) {
            const stdinNames = await readNamesFromStdin();
            if (stdinNames.length > 0) repos = stdinNames;
          }

          // --discard: delete corrupted record without reading it
          if (options.discard) {
            if (repos.length > 0) {
              const msg = "--discard deletes the entire operation record — it cannot be combined with [repos...]";
              error(msg);
              throw new ArbError(msg);
            }
            deleteOperationRecord(wsDir);
            info("Operation record cleared");
            return;
          }

          // Validate repo names against the operation record and pass it through
          // to avoid a redundant read inside runUndoFlow.
          let validatedRecord: OperationRecord | undefined;
          if (repos.length > 0) {
            const record = readOperationRecord(wsDir);
            if (!record) {
              const msg = "Nothing to undo";
              error(msg);
              throw new ArbError(msg);
            }
            const recordRepos = new Set(Object.keys(record.repos));
            const unknown = repos.filter((r) => !recordRepos.has(r));
            if (unknown.length > 0) {
              const msg = `Unknown repo${unknown.length > 1 ? "s" : ""} in operation record: ${unknown.join(", ")}`;
              error(msg);
              throw new ArbError(msg);
            }
            validatedRecord = record;
          }

          await runUndoFlow({
            wsDir,
            arbRootDir: ctx.arbRootDir,
            reposDir: ctx.reposDir,
            options,
            verb: "undo",
            repos: repos.length > 0 ? repos : undefined,
            record: validatedRecord,
          });
        },
      ),
    );
}
