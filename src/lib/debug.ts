import { dim, red } from "./output";

let debug = false;
let gitCallCount = 0;

export function enableDebug(): void {
	debug = true;
}

export function isDebug(): boolean {
	return debug;
}

export function debugLog(message: string): void {
	if (!debug) return;
	process.stderr.write(`${dim("[debug]")} ${message}\n`);
}

export function debugGit(command: string, durationMs: number, exitCode: number): void {
	if (!debug) return;
	gitCallCount++;
	const suffix =
		exitCode === 0
			? dim(`(${formatDuration(durationMs)}, exit ${exitCode})`)
			: red(`(${formatDuration(durationMs)}, exit ${exitCode})`);
	process.stderr.write(`${dim("[git]")} ${command}  ${suffix}\n`);
}

export function getGitCallCount(): number {
	return gitCallCount;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}
