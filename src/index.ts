import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command, type Help } from "commander";
import { registerAttachCommand } from "./commands/attach";
import { registerBranchCommand } from "./commands/branch";
import { registerCdCommand } from "./commands/cd";
import { registerCreateCommand } from "./commands/create";
import { registerDeleteCommand } from "./commands/delete";
import { registerDetachCommand } from "./commands/detach";
import { registerDiffCommand } from "./commands/diff";
import { registerDumpCommand } from "./commands/dump";
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
import { registerRenameCommand } from "./commands/rename";
import { registerRepoCommand } from "./commands/repo";
import { registerResetCommand } from "./commands/reset";
import { registerStatusCommand } from "./commands/status";
import { registerTemplateCommand } from "./commands/template";
import { ArbAbort, ArbError, checkForUpdate } from "./lib/core";
import { killActiveGitProcesses } from "./lib/git";
import { allTopics } from "./lib/help";
import { bold, dim, error, info } from "./lib/terminal";
import { debugLog, enableDebug, getGitCallCount, isDebug } from "./lib/terminal";
import { detectArbRoot, detectWorkspace } from "./lib/workspace";
import { ARB_VERSION } from "./version";

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "Setup Commands:": "  Set up the project and clone repos.",
  "Workspace Commands:": "  Create and manage workspaces.",
  "Inspection Commands:": "  Inspect workspace branch state across repositories.",
  "Synchronization Commands:": "  Synchronize workspace branches with remotes and base branches.",
  "Execution Commands:": "  Run commands or open tools across workspace repos.",
};

function arbFormatHelp(cmd: Command, helper: Help): string {
  const termWidth = helper.padWidth(cmd, helper);

  function callFormatItem(term: string, description: string): string {
    return helper.formatItem(term, termWidth, description, helper);
  }

  // Usage
  let output = [`${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`, ""];

  // Description (with optional Examples: block)
  const commandDescription = helper.commandDescription(cmd);
  if (commandDescription.length > 0) {
    const helpWidth = helper.helpWidth ?? 80;
    const examplesPrefix = "Examples:\n\n";
    if (commandDescription.startsWith(examplesPrefix)) {
      // Split into examples and prose at the first double-newline after the example lines
      const afterPrefix = commandDescription.slice(examplesPrefix.length);
      const splitIndex = afterPrefix.indexOf("\n\n");
      if (splitIndex !== -1) {
        const exampleLines = afterPrefix.slice(0, splitIndex);
        const prose = afterPrefix.slice(splitIndex + 2);
        output = output.concat([helper.styleTitle("Examples:"), exampleLines, ""]);
        if (prose.length > 0) {
          const indent = "  ";
          const wrapped = helper.boxWrap(helper.styleCommandDescription(prose), helpWidth - indent.length);
          const indented = wrapped
            .split("\n")
            .map((l) => indent + l)
            .join("\n");
          output = output.concat([helper.styleTitle("Description:"), indented, ""]);
        }
      } else {
        // No prose after examples — just render examples
        output = output.concat([helper.styleTitle("Examples:"), afterPrefix, ""]);
      }
    } else {
      output = output.concat([helper.boxWrap(helper.styleCommandDescription(commandDescription), helpWidth), ""]);
    }
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
        dim("https://github.com/henrikje/arborist"),
        "",
      ]);
    }
  }

  // Commands — grouped for root help, flat for subcommands
  const commandGroups = helper.groupItems(
    [...cmd.commands],
    helper.visibleCommands(cmd),
    (sub: Command) => sub.helpGroup() || "Commands:",
  );

  if (cmd.name() === "arb") {
    commandGroups.forEach((commands, group) => {
      if (commands.length === 0) return;
      const list = commands.map((subcommand) =>
        callFormatItem(
          helper.styleSubcommandTerm(helper.subcommandTerm(subcommand)),
          helper.styleSubcommandDescription(helper.subcommandDescription(subcommand)),
        ),
      );
      const description = GROUP_DESCRIPTIONS[group];
      if (description) {
        output = output.concat([helper.styleTitle(group), dim(description), "", ...list, ""]);
      } else {
        output = output.concat([helper.styleTitle(group), ...list, ""]);
      }
    });
  } else {
    commandGroups.forEach((commands, group) => {
      if (commands.length === 0) return;
      const list = commands.map((subcommand) =>
        callFormatItem(
          helper.styleSubcommandTerm(helper.subcommandTerm(subcommand)),
          helper.styleSubcommandDescription(helper.subcommandDescription(subcommand)),
        ),
      );
      output = output.concat([helper.styleTitle(group), ...list, ""]);
    });
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

const program = new Command();
program
  .name("arb")
  .enablePositionalOptions()
  .description("Arborist is a workspace manager that makes multi-repo development safe and simple.")
  .version(`Arborist ${ARB_VERSION}`, "--version")
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
    debugLog(`project: ${arbRoot ?? "(not found)"}`);
    if (arbRoot) {
      const ws = detectWorkspace(arbRoot);
      debugLog(`workspace: ${ws ?? "(none)"}`);
    }
  }
});

// Register all commands

// ── Setup Commands ──────────────────────────────────────────────
program.commandsGroup("Setup Commands:");
registerHelpCommand(program);
registerInitCommand(program);
registerRepoCommand(program);
registerTemplateCommand(program);

// ── Workspace Commands ──────────────────────────────────────────
program.commandsGroup("Workspace Commands:");
registerCreateCommand(program);
registerDeleteCommand(program);
registerRenameCommand(program);
registerListCommand(program);
registerPathCommand(program);
registerCdCommand(program);
registerAttachCommand(program);
registerDetachCommand(program);

// ── Inspection Commands ─────────────────────────────────────────
program.commandsGroup("Inspection Commands:");
registerStatusCommand(program);
registerBranchCommand(program);
registerLogCommand(program);
registerDiffCommand(program);

// ── Synchronization Commands ────────────────────────────────────
program.commandsGroup("Synchronization Commands:");
registerPullCommand(program);
registerPushCommand(program);
registerRebaseCommand(program);
registerMergeCommand(program);
registerResetCommand(program);

// ── Execution Commands ──────────────────────────────────────────
program.commandsGroup("Execution Commands:");
registerExecCommand(program);
registerOpenCommand(program);

// ── Hidden ──────────────────────────────────────────────────────
registerDumpCommand(program);

process.on("SIGINT", () => {
  killActiveGitProcesses();
  info("Aborted.");
  process.exit(130);
});

const commandStart = performance.now();

// Kick off update check early so it runs concurrently with the command
const arbRootForUpdate = detectArbRoot();
const updateCheckPromise = arbRootForUpdate ? checkForUpdate(ARB_VERSION, arbRootForUpdate) : null;

function printDebugSummary(): void {
  if (!isDebug()) return;
  const elapsed = ((performance.now() - commandStart) / 1000).toFixed(1);
  const count = getGitCallCount();
  debugLog(`${count} git ${count === 1 ? "call" : "calls"} in ${elapsed}s`);
}

try {
  await program.parseAsync();
  printDebugSummary();
  if (updateCheckPromise) {
    const TIMEOUT = Symbol("timeout");
    const result = await Promise.race([
      updateCheckPromise,
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(resolve, 100, TIMEOUT)),
    ]);
    if (result !== TIMEOUT && result !== null) {
      process.stderr.write(`\n${result.notice}`);
    }
  }
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
process.exit(0);
