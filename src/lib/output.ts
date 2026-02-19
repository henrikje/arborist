import { isTTY } from "./tty";

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[0;33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function color(code: string, text: string): string {
	if (!isTTY()) return text;
	return `${code}${text}${NC}`;
}

export function red(text: string): string {
	return color(RED, text);
}

export function green(text: string): string {
	return color(GREEN, text);
}

export function yellow(text: string): string {
	return color(YELLOW, text);
}

export function bold(text: string): string {
	return color(BOLD, text);
}

export function dim(text: string): string {
	return color(DIM, text);
}

export function success(text: string): void {
	process.stderr.write(`${green(text)}\n`);
}

export function info(text: string): void {
	process.stderr.write(`${text}\n`);
}

export function warn(text: string): void {
	process.stderr.write(`${yellow(text)}\n`);
}

export function error(text: string): void {
	process.stderr.write(`${red(text)}\n`);
}

export function boldLine(text: string): void {
	process.stderr.write(`${bold(text)}\n`);
}

export function inlineStart(repo: string, verb: string): void {
	if (isTTY()) {
		process.stderr.write(`  [${repo}] ${verb}...`);
	}
}

export function inlineResult(repo: string, text: string): void {
	if (isTTY()) {
		process.stderr.write(`\r\x1B[2K  [${repo}] ${text}\n`);
	} else {
		process.stderr.write(`  [${repo}] ${text}\n`);
	}
}

export function plural(count: number, singular: string, pluralForm?: string): string {
	return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

export function clearLines(count: number): void {
	if (!isTTY() || count <= 0) return;
	process.stderr.write(`\x1B[${count}A\x1B[J`);
}

export function countLines(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") count++;
	}
	return count;
}

export function dryRunNotice(): void {
	info("Dry run \u2014 no changes were made");
}

export function skipConfirmNotice(flag: string): void {
	info(`Skipping confirmation (${flag})`);
}

export function stderr(text: string): void {
	process.stderr.write(text);
}

export function stdout(text: string): void {
	process.stdout.write(text);
}
