import { isTTY } from "./tty";

const ENTER = "\x1b[?1049h\x1b[?25l"; // alternate screen + hide cursor
const LEAVE = "\x1b[?25h\x1b[?1049l"; // show cursor + leave alternate screen

export function enterAlternateScreen(): void {
  if (!isTTY()) return;
  process.stderr.write(ENTER);
}

export function leaveAlternateScreen(): void {
  if (!isTTY()) return;
  process.stderr.write(LEAVE);
}
