export function isTTY(): boolean {
	return Bun.stdout.writer().toString() !== "[object Blob]" && process.stderr.isTTY === true;
}
