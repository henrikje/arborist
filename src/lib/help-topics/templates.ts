import { bold, dim } from "../output";
import type { HelpTopic } from "./index";

export const templatesTopic: HelpTopic = {
	name: "templates",
	summary: "Template system quick reference",
	render() {
		const out = (text: string) => process.stdout.write(`${text}\n`);

		out(bold("TEMPLATE SYSTEM"));
		out("");
		out("  Templates live in .arb/templates/ and are automatically seeded into");
		out("  workspaces during 'arb create' and 'arb attach'.");
		out("");
		out(bold("SCOPES"));
		out("");
		out(`    ${bold("workspace")}   .arb/templates/workspace/`);
		out("                Files copied to the workspace root");
		out(`    ${bold("repo")}        .arb/templates/repos/<name>/`);
		out("                Files copied into the matching repo worktree");
		out("");
		out(bold("LIQUIDJS RENDERING"));
		out("");
		out("  Files ending with .arbtemplate are rendered with LiquidJS before");
		out("  being written. The extension is stripped at the destination.");
		out("");
		out(dim("  Available variables:"));
		out(`    ${dim("root.path")}                Arb root directory`);
		out(`    ${dim("workspace.name")}           Workspace name`);
		out(`    ${dim("workspace.path")}           Workspace directory`);
		out(`    ${dim("workspace.repos[]")}        Array of repo objects`);
		out(`    ${dim("repo.name")}                Current repo name (repo scope only)`);
		out(`    ${dim("repo.path")}                Current repo path (repo scope only)`);
		out(`    ${dim("repo.baseRemote.name")}     Base remote name (e.g. upstream)`);
		out(`    ${dim("repo.baseRemote.url")}      Base remote URL`);
		out(`    ${dim("repo.shareRemote.name")}    Share remote name (e.g. origin)`);
		out(`    ${dim("repo.shareRemote.url")}     Share remote URL`);
		out("");
		out(bold("DRIFT DETECTION"));
		out("");
		out("  Arb tracks whether seeded files have been edited by the user.");
		out("  When repos are attached or detached, templates referencing");
		out("  workspace.repos are automatically regenerated — but only if the");
		out("  user hasn't manually edited the file. Edited files are left as-is.");
		out("  Use 'arb template diff' to see which files have drifted from their");
		out("  template, and 'arb template apply --force' to reset them.");
		out("");
		out(bold("COMMANDS"));
		out("");
		out(`    ${dim("template add")}      Capture a file as a template`);
		out(`    ${dim("template list")}     List all defined templates`);
		out(`    ${dim("template diff")}     Show template drift (exits 1 if drift found)`);
		out(`    ${dim("template apply")}    Re-seed templates into the current workspace`);
		out("");
		out(bold("EXAMPLES"));
		out("");
		out(`  ${dim("arb template add .env.local")}`);
		out("    Capture a file as a template (scope auto-detected from path).");
		out("");
		out(`  ${dim("arb template add .claude --workspace")}`);
		out("    Capture a workspace-scoped template.");
		out("");
		out(`  ${dim("arb template diff")}`);
		out("    Show files that differ from their template source.");
		out("");
		out(`  ${dim("arb template apply --force")}`);
		out("    Reset all drifted files to match their templates.");
	},
};
