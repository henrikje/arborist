import { Command, type Help } from "commander";
import { registerAddCommand } from "./commands/add";
import { registerCdCommand } from "./commands/cd";
import { registerCloneCommand } from "./commands/clone";
import { registerCreateCommand } from "./commands/create";
import { registerDropCommand } from "./commands/drop";
import { registerExecCommand } from "./commands/exec";
import { registerFetchCommand } from "./commands/fetch";
import { registerInitCommand } from "./commands/init";
import { registerListCommand } from "./commands/list";
import { registerOpenCommand } from "./commands/open";
import { registerPathCommand } from "./commands/path";
import { registerPullCommand } from "./commands/pull";
import { registerPushCommand } from "./commands/push";
import { registerRemoveCommand } from "./commands/remove";
import { registerReposCommand } from "./commands/repos";
import { registerStatusCommand } from "./commands/status";
import { detectBaseDir, detectWorkspace } from "./lib/base-dir";
import { error } from "./lib/output";
import type { ArbContext } from "./lib/types";
import { ARB_VERSION } from "./version";

const SETUP_COMMANDS = new Set(["init", "clone", "repos", "help"]);
const WORKTREE_COMMANDS = new Set(["add", "drop", "status", "fetch", "pull", "push", "exec", "open"]);

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
	}

	// Options
	const optionList = helper.visibleOptions(cmd).map((option) => {
		return callFormatItem(
			helper.styleOptionTerm(helper.optionTerm(option)),
			helper.styleOptionDescription(helper.optionDescription(option)),
		);
	});
	if (optionList.length > 0) {
		output = output.concat([helper.styleTitle("Options:"), ...optionList, ""]);
	}

	// Commands — split into three groups
	const allCommands = helper.visibleCommands(cmd);
	const setupCommands = allCommands.filter((c) => SETUP_COMMANDS.has(c.name()));
	const workspaceCommands = allCommands.filter(
		(c) => !SETUP_COMMANDS.has(c.name()) && !WORKTREE_COMMANDS.has(c.name()),
	);
	const worktreeCommands = allCommands.filter((c) => WORKTREE_COMMANDS.has(c.name()));

	if (setupCommands.length > 0) {
		const list = setupCommands.map((c) => {
			return callFormatItem(
				helper.styleSubcommandTerm(helper.subcommandTerm(c)),
				helper.styleSubcommandDescription(helper.subcommandDescription(c)),
			);
		});
		output = output.concat([
			helper.styleTitle("Setup Commands:"),
			"  Set up the arb root and clone repos.",
			"",
			...list,
			"",
		]);
	}

	if (workspaceCommands.length > 0) {
		const list = workspaceCommands.map((c) => {
			return callFormatItem(
				helper.styleSubcommandTerm(helper.subcommandTerm(c)),
				helper.styleSubcommandDescription(helper.subcommandDescription(c)),
			);
		});
		output = output.concat([
			helper.styleTitle("Workspace Commands:"),
			"  Create and manage workspaces. Run from within an arb root.",
			"",
			...list,
			"",
		]);
	}

	if (worktreeCommands.length > 0) {
		const list = worktreeCommands.map((c) => {
			return callFormatItem(
				helper.styleSubcommandTerm(helper.subcommandTerm(c)),
				helper.styleSubcommandDescription(helper.subcommandDescription(c)),
			);
		});
		output = output.concat([
			helper.styleTitle("Worktree Commands:"),
			"  Manage worktrees. Run from within a workspace, or with -w <workspace>.",
			"",
			...list,
			"",
		]);
	}

	return output.join("\n");
}

function getCtx(): ArbContext {
	const baseDir = detectBaseDir();
	if (!baseDir) {
		error("Not inside an arb root. Run 'arb init' to set one up.");
		process.exit(1);
	}
	return {
		baseDir,
		reposDir: `${baseDir}/.arb/repos`,
		currentWorkspace: program.opts().workspace ?? detectWorkspace(baseDir),
	};
}

const program = new Command();
program
	.name("arb")
	.description("Arborist is a workspace manager for multi-repo projects built on Git worktrees.")
	.version(`Arborist ${ARB_VERSION}`, "-v, --version")
	.option("-w, --workspace <name>", "Target workspace (overrides auto-detect)")
	.usage("[options] [command]")
	.configureHelp({ formatHelp: arbFormatHelp })
	.configureOutput({
		outputError: (str) => {
			error(str.replace(/^error: /, "").trimEnd());
		},
	})
	.showSuggestionAfterError();

// Register all commands
registerInitCommand(program);
registerCloneCommand(program, getCtx);
registerReposCommand(program, getCtx);
registerCreateCommand(program, getCtx);
registerRemoveCommand(program, getCtx);
registerListCommand(program, getCtx);
registerPathCommand(program, getCtx);
registerCdCommand(program);
registerAddCommand(program, getCtx);
registerDropCommand(program, getCtx);
registerStatusCommand(program, getCtx);
registerFetchCommand(program, getCtx);
registerPullCommand(program, getCtx);
registerPushCommand(program, getCtx);
registerExecCommand(program, getCtx);
registerOpenCommand(program, getCtx);

try {
	await program.parseAsync();
} catch (err) {
	if (err instanceof Error && err.name === "ExitPromptError") {
		process.stderr.write("\nAborted.\n");
		process.exit(130);
	}
	throw err;
}
