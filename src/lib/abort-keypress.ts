import { isTTY } from "./tty";

export interface AbortKeypress {
	signal: AbortSignal;
	cleanup: () => void;
}

/**
 * Listen for Escape keypress to abort a background operation.
 * Returns an AbortSignal that fires when Escape is pressed, plus a cleanup function.
 *
 * Guards on process.stdin.isTTY — returns a never-aborted signal when stdin is piped.
 * Handles Ctrl-C (0x03) in raw mode by restoring terminal state and re-raising SIGINT.
 */
export function listenForAbortKeypress(): AbortKeypress {
	const controller = new AbortController();

	if (!process.stdin.isTTY || !isTTY()) {
		return { signal: controller.signal, cleanup: () => {} };
	}

	const stdin = process.stdin;
	let cleaned = false;

	const restore = () => {
		if (cleaned) return;
		cleaned = true;
		stdin.setRawMode(false);
		stdin.removeListener("data", onData);
		stdin.unref();
		process.removeListener("exit", onExit);
	};

	const onData = (data: Buffer) => {
		// Ctrl-C: restore terminal and re-raise SIGINT
		if (data.length === 1 && data[0] === 0x03) {
			restore();
			process.kill(process.pid, "SIGINT");
			return;
		}

		// Standalone Escape (not part of an escape sequence)
		if (data.length === 1 && data[0] === 0x1b) {
			controller.abort();
			restore();
			return;
		}
	};

	const onExit = () => {
		restore();
	};

	stdin.setRawMode(true);
	stdin.resume();
	stdin.on("data", onData);
	stdin.unref(); // Don't keep process alive just for keypress listener
	process.on("exit", onExit);

	return { signal: controller.signal, cleanup: restore };
}
