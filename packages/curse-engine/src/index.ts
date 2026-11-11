export * from "./ast.js";
export { CurseSyntaxError } from "./errors.js";
export { tokenize, type Token, type TokenKind } from "./tokenizer.js";
export { parseCurse, tryParseCurse, type ParseResult } from "./parser.js";
export {
  createExecutor, Executor, UndeclaredCapabilityError, durationMs, hasCapability, catastrophicShape, MATCH_SUBJECT_CAP,
  type Capabilities, type CapabilityName, type EngineEvent, type ExecutorOptions,
  type DecisionRecord, type ConditionRecord, type ActionRecord,
} from "./executor.js";
export {
  simulate, summaryLine,
  type IntendedAction, type SimulateOptions, type SimulationReport, type SimulationSummary, type SuppressedEvent, type KindCounts,
} from "./simulator.js";
export {
  AuditLog, AlreadyReversedError, NotReversibleError, UnknownEntryError,
  type AuditEntry, type NewAuditEntry, type Inverse,
} from "./grimoire.js";
