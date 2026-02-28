import { bold, dim } from "../output";
import type { HelpTopic } from "./index";

export const stackedTopic: HelpTopic = {
	name: "stacked",
	summary: "Stacked workspaces (branching off features)",
	render() {
		const out = (text: string) => process.stdout.write(`${text}\n`);

		out(bold("STACKED WORKSPACES"));
		out("");
		out("  A stacked workspace branches off another feature branch instead of the");
		out("  default branch (e.g. main). This lets you build on work that hasn't");
		out("  been merged yet, creating a chain of dependent feature branches.");
		out("");
		out(bold("CREATING"));
		out("");
		out(`  ${dim("arb create <name> --base <branch>")}`);
		out("");
		out("  The --base flag sets the branch that arb will rebase onto and track.");
		out("  This is stored in .arbws/config and used by status, rebase, and merge.");
		out("  Without --base, arb uses the default branch (e.g. main).");
		out("");
		out(bold("STATUS FLAGS"));
		out("");
		out("  Stacked workspaces can have additional status flags:");
		out("");
		out(`    ${bold("behind-base")}    The base branch has new commits not yet integrated`);
		out(`    ${bold("base-merged")}    The configured base branch was merged into the`);
		out("                   default branch (stack collapsed)");
		out(`    ${bold("base-missing")}   The configured base branch was not found;`);
		out("                   fell back to the default branch");
		out("");
		out(bold("RETARGETING"));
		out("");
		out("  When a base branch is merged, the stacked workspace needs to be");
		out("  retargeted to the default branch (or another branch):");
		out("");
		out(`  ${dim("arb rebase --retarget")}`);
		out("    Rebases onto the default branch and updates .arbws/config.");
		out("");
		out(`  ${dim("arb rebase --retarget <branch>")}`);
		out("    Retargets to a specific branch — useful for deep stacks where the");
		out("    base was merged into another feature branch, not the default.");
		out("");
		out(bold("EXAMPLES"));
		out("");
		out(`  ${dim("arb create auth-ui --base feat/auth-api")}`);
		out("    Create a workspace stacked on the auth-api feature branch.");
		out("");
		out(`  ${dim("arb status")}`);
		out("    Shows behind-base if feat/auth-api has new commits,");
		out("    or base-merged if it was merged into main.");
		out("");
		out(`  ${dim("arb rebase --retarget")}`);
		out("    After feat/auth-api is merged, retarget onto main.");
		out("");
		out(`  ${dim("arb rebase --retarget feat/auth-api")}`);
		out("    In a deeper stack (C on B on A), retarget C onto A.");
	},
};
