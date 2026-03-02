import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command, type Help } from "commander";
import { registerAttachCommand } from "./commands/attach";
import { registerBranchCommand } from "./commands/branch";
import { registerCdCommand } from "./commands/cd";
import { registerCleanCommand } from "./commands/clean";
import { registerCreateCommand } from "./commands/create";
import { registerDeleteCommand } from "./commands/delete";
import { registerDetachCommand } from "./commands/detach";
import { registerDiffCommand } from "./commands/diff";
import { registerExecCommand } from "./commands/exec";
import { registerHelpCommand } from "./commands/help";
import { registerInitCommand } from "./commands/init";
import { registerListCommand } from "./commands/list";
import { registerLogCommand } from "./commands/log";
import { registerMergeCommand } from "./commands/merge";
import { registerOpenCommand } from "./commands/open";
import { registerPathCommand } from "./commands/path";
import { registerPullCommand } from "./commands/pull";
import { registerPushCommand } from "./commands/push";
import { registerRebaseCommand } from "./commands/rebase";
import { registerRepoCommand } from "./commands/repo";
import { registerStatusCommand } from "./commands/status";
import { registerTemplateCommand } from "./commands/template";
import { detectArbRoot, detectWorkspace } from "./lib/arb-root";
import { debugLog, enableDebug, getGitCallCount, isDebug } from "./lib/debug";
import { ArbAbort, ArbError } from "./lib/errors";
import { allTopics } from "./lib/help-topics";
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
		commands: ["status", "branch", "log", "diff"],
	},
	{
		title: "Synchronization Commands:",
		description: "  Synchronize workspace branches with remotes and base branches.",
		commands: ["pull", "push", "rebase", "merge"],
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

	// Help Topics (root command only, before options)
	if (cmd.name() === "arb") {
		const topics = allTopics();
		if (topics.length > 0) {
			const topicList = topics.map((t) =>
				callFormatItem(helper.styleSubcommandTerm(t.name), helper.styleSubcommandDescription(t.summary)),
			);
			output = output.concat([
				helper.styleTitle("Help Topics:"),
				dim("  Run 'arb help <topic>' to read about a topic."),
				"",
				...topicList,
				"",
			]);
		}
	}

	// Global Options
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
		throw new ArbError("Not inside an arb root. Run 'arb init' to set one up.");
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
	.option("--debug", "Enable debug output")
	.usage("[options] [command]")
	.configureHelp({ formatHelp: arbFormatHelp, styleTitle: (str) => bold(str) })
	.configureOutput({
		outputError: (str) => {
			error(str.replace(/^error: /, "").trimEnd());
		},
	})
	.showSuggestionAfterError();

program.hook("preAction", () => {
	const opts = program.opts();

	if (opts.debug || process.env.ARB_DEBUG === "1") {
		enableDebug();
	}

	const cwdOpt = opts.C;
	if (cwdOpt) {
		const resolved = resolve(cwdOpt);
		if (!existsSync(resolved)) {
			error(`Cannot change to '${cwdOpt}': no such directory`);
			throw new ArbError(`Cannot change to '${cwdOpt}': no such directory`);
		}
		process.chdir(resolved);
	}

	if (isDebug()) {
		const arbRoot = detectArbRoot();
		debugLog(`arb root: ${arbRoot ?? "(not found)"}`);
		if (arbRoot) {
			const ws = detectWorkspace(arbRoot);
			debugLog(`workspace: ${ws ?? "(none)"}`);
		}
	}
});

// Register all commands
registerHelpCommand(program);
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
registerBranchCommand(program, getCtx);
registerPullCommand(program, getCtx);
registerPushCommand(program, getCtx);
registerRebaseCommand(program, getCtx);
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

const commandStart = performance.now();

function printDebugSummary(): void {
	if (!isDebug()) return;
	const elapsed = ((performance.now() - commandStart) / 1000).toFixed(1);
	const count = getGitCallCount();
	debugLog(`${count} git ${count === 1 ? "call" : "calls"} in ${elapsed}s`);
}

try {
	await program.parseAsync();
	printDebugSummary();
} catch (err) {
	printDebugSummary();
	if (err instanceof ArbAbort) {
		info(err.message);
		process.exit(130);
	}
	if (err instanceof ArbError) {
		process.exit(1);
	}
	if (err instanceof Error && err.name === "ExitPromptError") {
		process.stderr.write("\n");
		info("Aborted.");
		process.exit(130);
	}
	throw err;
}
