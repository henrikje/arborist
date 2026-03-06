import { clearLines, countLines, stderr } from "../terminal/output";
import { suppressStdin } from "../terminal/suppress-stdin";

export interface RenderPhase {
  render: () => string | Promise<string>;
  write?: (output: string) => void;
}

export async function runPhasedRender(phases: RenderPhase[]): Promise<void> {
  const { restore } = suppressStdin();
  let prevOutput: string | undefined;

  try {
    for (const phase of phases) {
      const output = await phase.render();
      if (prevOutput !== undefined) {
        process.stderr.write("\r");
        clearLines(countLines(prevOutput, process.stderr.columns));
      }
      const write = phase.write ?? stderr;
      write(output);
      prevOutput = output;
    }
  } finally {
    restore();
  }
}
