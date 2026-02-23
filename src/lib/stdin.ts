/**
 * Read names from stdin when piped (one per line).
 * Returns an empty array if stdin is a TTY (not piped).
 */
export async function readNamesFromStdin(): Promise<string[]> {
	if (process.stdin.isTTY) return [];
	const text = await Bun.stdin.text();
	return text
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
}
