import { clearLines, countLines, stderr } from "./output";

export interface RenderPhase {
	render: () => string | Promise<string>;
	write?: (output: string) => void;
}

export async function runPhasedRender(phases: RenderPhase[]): Promise<void> {
	let prevOutput: string | undefined;

	for (const phase of phases) {
		if (prevOutput !== undefined) {
			process.stderr.write("\r");
			clearLines(countLines(prevOutput));
		}

		const output = await phase.render();
		const write = phase.write ?? stderr;
		write(output);
		prevOutput = output;
	}
}
