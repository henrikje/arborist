import { bold, dim } from "../output";
import type { HelpTopic } from "./index";

export const scriptingTopic: HelpTopic = {
	name: "scripting",
	summary: "Scripting patterns and conventions",
	render() {
		const out = (text: string) => process.stdout.write(`${text}\n`);

		out(bold("SCRIPTING & AUTOMATION"));
		out("");
		out("  Arborist follows Unix conventions for composability: human-friendly");
		out("  output on stderr, machine-readable data on stdout.");
		out("");
		out(bold("OUTPUT STREAMS"));
		out("");
		out(`    ${bold("stderr")}   Progress, prompts, tables, colored output (UX)`);
		out(`    ${bold("stdout")}   Data output: names (-q), JSON (--json), schemas (--schema)`);
		out("");
		out(bold("OUTPUT MODES"));
		out("");
		out(`    ${dim("(default)")}    Human-readable table on stderr`);
		out(`    ${dim("-q, --quiet")}  One item per line on stdout (repo or workspace names)`);
		out(`    ${dim("--json")}       Structured JSON on stdout`);
		out(`    ${dim("--schema")}     JSON Schema describing --json output on stdout`);
		out("");
		out("  Commands with these modes: status, list, branch, log, diff, repo list.");
		out("");
		out(bold("EXIT CODES"));
		out("");
		out(`    ${dim("0")}     Success`);
		out(`    ${dim("1")}     Error (including 'template diff' when drift is found)`);
		out(`    ${dim("130")}   Aborted (SIGINT or user cancelled a prompt)`);
		out("");
		out(bold("STDIN COMPOSITION"));
		out("");
		out("  Commands that accept repo names also read from stdin (one per line)");
		out("  when piped. This enables composition between commands:");
		out("");
		out(`  ${dim("arb status -q --where dirty | arb log")}`);
		out("    Show commits only for repos with uncommitted changes.");
		out("");
		out(`  ${dim("arb status -q --where behind-base | arb rebase")}`);
		out("    Rebase only repos that are behind the base branch.");
		out("");
		out(bold("DRY RUN"));
		out("");
		out("  Mutation commands (push, pull, rebase, merge, delete, rebranch)");
		out("  support -n/--dry-run to preview what would happen without executing.");
		out("");
		out(bold("EXAMPLES"));
		out("");
		out(`  ${dim("arb status --json | jq '.repos[] | select(.dirty) | .name'")}`);
		out("    Extract dirty repo names from JSON output.");
		out("");
		out(`  ${dim("arb branch -q")}`);
		out("    Print just the workspace branch name for use in scripts.");
		out("");
		out(`  ${dim("arb template diff || echo 'Templates have drifted'")}`);
		out("    CI check: fail the build if templates are out of sync.");
		out("");
		out(`  ${dim("arb list -q | xargs -I{} arb -C {} push --yes")}`);
		out("    Push all workspaces in one go.");
	},
};
