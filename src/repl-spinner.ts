// input: Status text from REPL event handler
// output: Braille dot animation on terminal stdout
// pos: Terminal spinner providing visual feedback during agent processing

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export class TerminalSpinner {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private statusText = "";
  private stream: NodeJS.WriteStream;
  private dimFn: (s: string) => string;

  constructor(
    stream: NodeJS.WriteStream = process.stdout,
    dimFn: (s: string) => string = (s) => `\x1b[2m${s}\x1b[0m`,
  ) {
    this.stream = stream;
    this.dimFn = dimFn;
  }

  get isActive(): boolean {
    return this.timer !== null;
  }

  start(status: string): void {
    if (this.timer) this.stop();
    this.statusText = status;
    this.frameIndex = 0;
    this.render();
    this.timer = setInterval(() => this.render(), INTERVAL_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.clear();
  }

  update(status: string): void {
    this.statusText = status;
    if (this.timer) this.render();
  }

  guardedWrite(chunk: string): void {
    if (this.isActive) {
      this.clear();
      this.stream.write(chunk);
      this.render();
    } else {
      this.stream.write(chunk);
    }
  }

  private clear(): void {
    this.stream.write("\r\x1b[K");
  }

  private render(): void {
    const frame = FRAMES[this.frameIndex % FRAMES.length];
    this.frameIndex++;
    this.stream.write(`\r  ${this.dimFn(frame)} ${this.statusText}`);
  }
}
