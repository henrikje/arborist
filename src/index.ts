import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command, type Help } from "commander";
import { registerAttachCommand } from "./commands/attach";
import { registerCdCommand } from "./commands/cd";
import { registerCleanCommand } from "./commands/clean";
import { registerCreateCommand } from "./commands/create";
import { registerDeleteCommand } from "./commands/delete";
import { registerDetachCommand } from "./commands/detach";
import { registerDiffCommand } from "./commands/diff";
import { registerExecCommand } from "./commands/exec";
import { registerInitCommand } from "./commands/init";
import { registerListCommand } from "./commands/list";
import { registerLogCommand } from "./commands/log";
import { registerMergeCommand } from "./commands/merge";
import { registerOpenCommand } from "./commands/open";
import { registerPathCommand } from "./commands/path";
import { registerPullCommand } from "./commands/pull";
import { registerPushCommand } from "./commands/push";
import { registerRebaseCommand } from "./commands/rebase";
import { registerRebranchCommand } from "./commands/rebranch";
import { registerRepoCommand } from "./commands/repo";
import { registerStatusCommand } from "./commands/status";
import { registerTemplateCommand } from "./commands/template";
import { detectArbRoot, detectWorkspace } from "./lib/arb-root";
import { bold, dim, error, info } from "./lib/output";
import type { ArbContext } from "./lib/types";
import { ARB_VERSION } from "./version";

const COMMAND_GROUPS = [
	{
		title: "Setup Commands:",
		description: "  Set up the arb root and clone repos.",
		commands: ["init", "repo", "template", "help"],
	},
	{
		title: "Workspace Commands:",
		description: "  Create and manage workspaces.",
		commands: ["create", "delete", "clean", "list", "path", "cd", "attach", "detach"],
	},
	{
		title: "Inspection Commands:",
		description: "  Inspect workspace branch state across repositories.",
		commands: ["status", "log", "diff"],
	},
	{
		title: "Synchronization Commands:",
		description: "  Synchronize workspace branches with remotes and base branches.",
		commands: ["pull", "push", "rebase", "rebranch", "merge"],
	},
	{
		title: "Execution Commands:",
		description: "  Run commands or open tools across workspace repos.",
		commands: ["exec", "open"],
	},
] as const;

function arbFormatHelp(cmd: Command, helper: Help): string {
	const termWidth = helper.padWidth(cmd, helper);

	function callFormatItem(term: string, description: string): string {
		return helper.formatItem(term, termWidth, description, helper);
	}

	// Usage
	let output = [`${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`, ""];

	// Description
	const commandDescription = helper.commandDescription(cmd);
	if (commandDescription.length > 0) {
		const helpWidth = helper.helpWidth ?? 80;
		output = output.concat([helper.boxWrap(helper.styleCommandDescription(commandDescription), helpWidth), ""]);
		// Extra description lines for the root command only
		if (cmd.name() === "arb") {
			output = output.concat([
				helper.boxWrap(
					"Built on Git worktrees, it creates isolated workspaces so you can work on cross-repo features in parallel.",
					helpWidth,
				),
				"",
				dim("arborist (noun) \u02C8\u00E4r-b\u0259-rist \u2014 a specialist in the care and maintenance of trees"),
				"",
			]);
		}
	}

	// Commands — grouped for root help, flat for subcommands
	const allCommands = helper.visibleCommands(cmd);

	if (cmd.name() === "arb") {
		const commandsByName = new Map(allCommands.map((subcommand) => [subcommand.name(), subcommand]));

		for (const group of COMMAND_GROUPS) {
			const groupedCommands = group.commands
				.map((name) => commandsByName.get(name))
				.filter((subcommand): subcommand is Command => Boolean(subcommand));
			if (groupedCommands.length === 0) {
				continue;
			}
			const list = groupedCommands.map((subcommand) =>
				callFormatItem(
					helper.styleSubcommandTerm(helper.subcommandTerm(subcommand)),
					helper.styleSubcommandDescription(helper.subcommandDescription(subcommand)),
				),
			);
			output = output.concat([helper.styleTitle(group.title), dim(group.description), "", ...list, ""]);
		}
	} else if (allCommands.length > 0) {
		const list = allCommands.map((subcommand) =>
			callFormatItem(
				helper.styleSubcommandTerm(helper.subcommandTerm(subcommand)),
				helper.styleSubcommandDescription(helper.subcommandDescription(subcommand)),
			),
		);
		output = output.concat([helper.styleTitle("Commands:"), ...list, ""]);
	}

	// Global Options (moved after commands)
	const optionList = helper.visibleOptions(cmd).map((option) => {
		return callFormatItem(
			helper.styleOptionTerm(helper.optionTerm(option)),
			helper.styleOptionDescription(helper.optionDescription(option)),
		);
	});
	if (optionList.length > 0) {
		output = output.concat([helper.styleTitle("Options:"), ...optionList, ""]);
	}

	return output.join("\n");
}

function getCtx(): ArbContext {
	const arbRootDir = detectArbRoot();
	if (!arbRootDir) {
		error("Not inside an arb root. Run 'arb init' to set one up.");
		process.exit(1);
	}
	return {
		arbRootDir,
		reposDir: `${arbRootDir}/.arb/repos`,
		currentWorkspace: detectWorkspace(arbRootDir),
	};
}

const program = new Command();
program
	.name("arb")
	.enablePositionalOptions()
	.description("Arborist is a workspace manager that makes multi-repo development safe and simple.")
	.version(`Arborist ${ARB_VERSION}`, "-v, --version")
	.option("-C <directory>", "Run as if arb was started in <directory>")
	.usage("[options] [command]")
	.configureHelp({ formatHelp: arbFormatHelp, styleTitle: (str) => bold(str) })
	.configureOutput({
		outputError: (str) => {
			error(str.replace(/^error: /, "").trimEnd());
		},
	})
	.showSuggestionAfterError();

program.hook("preAction", () => {
	const cwdOpt = program.opts().C;
	if (cwdOpt) {
		const resolved = resolve(cwdOpt);
		if (!existsSync(resolved)) {
			error(`Cannot change to '${cwdOpt}': no such directory`);
			process.exit(1);
		}
		process.chdir(resolved);
	}
});

// Register all commands
registerInitCommand(program);
registerRepoCommand(program, getCtx);
registerCreateCommand(program, getCtx);
registerDeleteCommand(program, getCtx);
registerCleanCommand(program, getCtx);
registerListCommand(program, getCtx);
registerPathCommand(program, getCtx);
registerCdCommand(program, getCtx);
registerAttachCommand(program, getCtx);
registerDetachCommand(program, getCtx);
registerStatusCommand(program, getCtx);
registerPullCommand(program, getCtx);
registerPushCommand(program, getCtx);
registerRebaseCommand(program, getCtx);
registerRebranchCommand(program, getCtx);
registerMergeCommand(program, getCtx);
registerExecCommand(program, getCtx);
registerLogCommand(program, getCtx);
registerDiffCommand(program, getCtx);
registerOpenCommand(program, getCtx);
registerTemplateCommand(program, getCtx);

process.on("SIGINT", () => {
	info("Aborted.");
	process.exit(130);
});

try {
	await program.parseAsync();
} catch (err) {
	if (err instanceof Error && err.name === "ExitPromptError") {
		process.stderr.write("\n");
		info("Aborted.");
		process.exit(130);
	}
	throw err;
}
