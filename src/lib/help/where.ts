import { bold, dim } from "../terminal";
import type { HelpTopic } from "./types";

export const whereFilterTopic: HelpTopic = {
  name: "where",
  summary: "Filter syntax for --where",
  render() {
    const out = (text: string) => process.stdout.write(`${text}\n`);

    out(bold("WHERE FILTER SYNTAX"));
    out("");
    out("  The --where flag filters repos (or workspaces) by status flags.");
    out("  It is supported by: status, list, exec, open, log, diff, delete, push, pull, rebase, merge.");
    out("");
    out(bold("SYNTAX"));
    out("");
    out(`  ${dim("Comma (,)")}   OR  — match repos with any of the listed conditions`);
    out(`  ${dim("Plus  (+)")}   AND — match repos with all of the listed conditions`);
    out(`  ${dim("Caret (^)")}   NOT — negate the following term`);
    out("");
    out("  + binds tighter than comma:");
    out("    --where dirty+ahead-share,gone = (dirty AND ahead-share) OR gone");
    out("");
    out(bold("FILTER TERMS"));
    out("");
    out(dim("  Problem / status flags:"));
    out("    dirty          Uncommitted changes (staged, modified, or untracked files)");
    out("    ahead-share    Local commits ahead of the share remote");
    out("    no-share       No share branch exists on the remote");
    out("    behind-share   Share remote has commits not yet pulled");
    out("    ahead-base     Local commits ahead of the base branch");
    out("    behind-base    Base branch has commits not yet rebased/merged");
    out("    conflict       Merge conflicts in the working tree");
    out("    diverged       Both ahead of and behind the base branch");
    out("    wrong-branch   Repo is on a different branch than the workspace");
    out("    detached       HEAD is detached (not on any branch)");
    out("    operation      A git operation is in progress (rebase, merge, etc.)");
    out("    gone           Tracking branch has been deleted on the remote");
    out("    shallow        Repository is a shallow clone");
    out("    merged         Feature branch has been merged into the base branch");
    out("    base-merged    Configured base branch was merged into the default branch");
    out("    base-missing   Configured base branch not found, fell back to default");
    out("    timed-out      Git commands timed out (cloud-synced files not yet downloaded)");
    out("    at-risk        Would lose work or need attention if deleted (dirty, unpushed,");
    out("                   wrong-branch, detached, operation, timed-out, shallow, base-merged, base-missing)");
    out("    stale          Any of: behind-share, behind-base, diverged");
    out("");
    out(dim("  Healthy / positive flags:"));
    out("    clean          No uncommitted changes (opposite of dirty)");
    out("    pushed         All commits pushed and branch exists on the share remote");
    out("    safe           No risk of losing work if deleted (opposite of at-risk)");
    out("");
    out(bold("EXAMPLES"));
    out("");
    out(`  ${dim("arb status --where dirty")}              Show only dirty repos`);
    out(`  ${dim("arb status --where ^dirty")}             Show only clean repos`);
    out(`  ${dim("arb status --where dirty,ahead-share")}  Dirty OR ahead-share`);
    out(`  ${dim("arb status --where dirty+ahead-share")}  Dirty AND ahead-share`);
    out(`  ${dim("arb exec --where dirty git stash")}      Stash in all dirty repos`);
    out(`  ${dim("arb delete --where gone")}               Delete all gone workspaces`);
    out(`  ${dim("arb list --where stale")}                List workspaces with any stale repo`);
    out(`  ${dim("arb push --where ^behind-base")}          Push only repos already rebased`);
    out(`  ${dim("arb rebase --where ^diverged")}          Skip diverged repos, rebase the rest`);
    out("");
    out(bold("AGE-BASED FILTERING"));
    out("");
    out("  --older-than and --newer-than filter list and delete by workspace age");
    out("  (most recent file activity: commits, uncommitted edits, .claude/, etc.).");
    out("  They compose with --where as AND:");
    out("");
    out(`  ${dim("arb list --older-than 30d")}              Workspaces with no activity in 30+ days`);
    out(`  ${dim("arb list --newer-than 7d")}               Workspaces active in the last week`);
    out(`  ${dim("arb delete --older-than 90d --where gone --yes")}  Delete old merged workspaces`);
    out("");
    out("  Durations: d (days), w (weeks), m (months), y (years). Examples: 30d, 2w, 3m, 1y.");
  },
};
