import { bold, dim } from "../output";
import type { HelpTopic } from "./index";

export const remotesTopic: HelpTopic = {
	name: "remotes",
	summary: "Fork workflows and remote roles",
	render() {
		const out = (text: string) => process.stdout.write(`${text}\n`);

		out(bold("REMOTE ROLES"));
		out("");
		out("  Arborist assigns each remote one of two roles:");
		out("");
		out(`    ${bold("base")}    Source of the base branch (e.g. main). Used by rebase and merge.`);
		out(`    ${bold("share")}   Where feature branches are shared. Used by push and pull.`);
		out("");
		out("  In single-remote repos, origin fills both roles.");
		out("  In fork workflows, upstream is typically base and origin is share.");
		out("");
		out(bold("RESOLUTION ORDER"));
		out("");
		out("  Arborist resolves remote roles automatically using this order:");
		out("");
		out("    1. Single remote        Use it for both base and share");
		out("    2. remote.pushDefault   That remote becomes share; determine base");
		out("                            from the remaining remotes");
		out("    3. upstream + origin    Convention: base=upstream, share=origin");
		out("    4. origin only          Both roles use origin");
		out("    5. Ambiguous            Error with guidance on how to configure");
		out("");
		out(bold("FORK WORKFLOW"));
		out("");
		out("  To set up a fork workflow when cloning:");
		out("");
		out(`    ${dim("arb repo clone <your-fork-url> <name> --upstream <canonical-url>")}`);
		out("");
		out("  This clones origin (your fork), adds upstream (the canonical repo),");
		out("  and sets remote.pushDefault=origin so arb resolves roles correctly.");
		out("");
		out("  To configure an existing repo manually:");
		out("");
		out(`    ${dim("git -C .arb/repos/<name> remote add upstream <canonical-url>")}`);
		out(`    ${dim("git -C .arb/repos/<name> config remote.pushDefault origin")}`);
		out("");
		out(bold("COMMANDS"));
		out("");
		out(`    ${dim("push, pull")}         Operate on the ${bold("share")} remote`);
		out(`    ${dim("rebase, merge")}      Integrate from the ${bold("base")} remote`);
		out(`    ${dim("repo list")}          Show resolved roles for each repo`);
		out(`    ${dim("branch -v")}          Show per-repo remote tracking detail`);
		out("");
		out(bold("EXAMPLES"));
		out("");
		out(`  ${dim("arb repo clone git@github.com:me/api.git api --upstream git@github.com:org/api.git")}`);
		out("    Clone a fork with upstream configured in one step.");
		out("");
		out(`  ${dim("arb repo list")}`);
		out("    Verify which remote is base and which is share for each repo.");
		out("");
		out(`  ${dim("git -C .arb/repos/api config remote.pushDefault origin")}`);
		out("    Manually set the share remote when arb cannot determine roles.");
	},
};
