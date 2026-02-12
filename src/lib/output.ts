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

export function info(text: string): void {
	process.stderr.write(`${green(text)}\n`);
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

let hintShown = false;

export function hint(text: string): void {
	if (!hintShown) {
		hintShown = true;
		process.stderr.write("\n");
	}
	process.stderr.write(`${dim(text)}\n`);
}

export function resetHint(): void {
	hintShown = false;
}

export function stderr(text: string): void {
	process.stderr.write(text);
}

export function stdout(text: string): void {
	process.stdout.write(text);
}
