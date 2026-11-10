/** Line-level syntax error (maps to the 422 {line, message} API contract). */
export class CurseSyntaxError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(line: number, column: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = "CurseSyntaxError";
    this.line = line;
    this.column = column;
  }
  /** Message without the "line N:" prefix. */
  get detail(): string {
    return this.message.replace(/^line \d+: /, "");
  }
}
