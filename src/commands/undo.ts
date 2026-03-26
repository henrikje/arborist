import type { Command } from "commander";
import { arbAction, deleteOperationRecord } from "../lib/core";
import { runUndoFlow } from "../lib/sync";
import { info } from "../lib/terminal";
import { requireWorkspace } from "../lib/workspace";

// ── Command registration ──

export function registerUndoCommand(program: Command): void {
  program
    .command("undo")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-n, --dry-run", "Show what would happen without executing")
    .option("-v, --verbose", "Show commits being rolled back in the plan")
    .option("-f, --force", "Delete a corrupted operation record without attempting to undo")
    .summary("Undo the last workspace operation")
    .description(
      "Reverses the most recent workspace operation (branch rename, retarget, rebase, merge, or pull). Reads the operation record from .arbws/operation.json, shows what will be undone, and asks for confirmation.\n\nFor branch renames: reverses the git branch -m and restores the workspace config.\nFor sync operations (rebase, merge, retarget): resets repos to their pre-operation HEAD and aborts any in-progress git operations.\n\nIf any repo has drifted (HEAD moved since the operation), undo is refused with an explanation. Use --yes to skip the confirmation prompt. Use --verbose to show the individual commits that will be rolled back for each repo.\n\nUse --force to delete a corrupted operation record without attempting to undo. This is an escape hatch when the record is unreadable.",
    )
    .action(
      arbAction(async (ctx, options: { yes?: boolean; dryRun?: boolean; verbose?: boolean; force?: boolean }) => {
        const { wsDir } = requireWorkspace(ctx);

        // --force: delete corrupted record without reading it
        if (options.force) {
          deleteOperationRecord(wsDir);
          info("Operation record cleared");
          return;
        }

        await runUndoFlow({
          wsDir,
          arbRootDir: ctx.arbRootDir,
          reposDir: ctx.reposDir,
          options,
          verb: "undo",
        });
      }),
    );
}
