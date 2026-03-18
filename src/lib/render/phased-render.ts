import { clearLines, countLines, stderr } from "../terminal/output";
import { suppressEcho } from "../terminal/suppress-echo";
import { suppressStdin } from "../terminal/suppress-stdin";

export interface RenderPhase {
  render: () => string | Promise<string>;
  write?: (output: string) => void;
}

export interface PhasedRenderOptions {
  /** Use echo suppression instead of raw mode so typed characters stay in the
   *  kernel input buffer and survive for the shell after this process exits. */
  preserveTypeahead?: boolean;
}

export async function runPhasedRender(phases: RenderPhase[], options?: PhasedRenderOptions): Promise<void> {
  const { restore } = options?.preserveTypeahead ? suppressEcho() : suppressStdin();
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
