/**
 * Audit log (grimoire) primitive. Append-only within a host's lifetime: inside a running host, entries are never edited or deleted. A host reset (for example GrimMod's fixture refresh) starts a new host lifetime with an empty log. Undo APPENDS a reversal
 * entry that references the original; whether an entry has been reversed is derived from the log itself.
 */
import type { CapabilityName, DecisionRecord } from "./executor.js";

export interface AuditEntry {
  readonly id: string;
  /** 1-based position in the log. */
  readonly seq: number;
  readonly curse: string;
  readonly eventId: string;
  readonly eventSummary: string;
  /** Decision path: the conditions that held, as text. */
  readonly path: string;
  readonly kind: CapabilityName;
  readonly target: string;
  readonly at: number;
  readonly status: "applied" | "reversed";
  /** For a reversal entry: id of the entry it reverses. */
  readonly reversalOf?: string;
  /** Opaque host reference to the effect this entry produced (used by the inverse). */
  readonly ref?: string;
}

export type NewAuditEntry = Omit<AuditEntry, "id" | "seq" | "status" | "reversalOf">;

export class AlreadyReversedError extends Error {}
export class NotReversibleError extends Error {}
export class UnknownEntryError extends Error {}

/** Host-supplied inverse for each reversible action kind. */
export type Inverse = Partial<Record<CapabilityName, (entry: AuditEntry) => void>>;

export class AuditLog {
  private list: AuditEntry[] = [];

  get entries(): readonly AuditEntry[] { return this.list; }

  get(id: string): AuditEntry | undefined { return this.list.find((e) => e.id === id); }

  isReversed(id: string): boolean { return this.list.some((e) => e.reversalOf === id); }

  record(input: NewAuditEntry): AuditEntry {
    const seq = this.list.length + 1;
    const entry: AuditEntry = Object.freeze({ ...input, id: `g-${String(seq).padStart(6, "0")}`, seq, status: "applied" as const });
    this.list.push(entry);
    return entry;
  }

  /** One entry per TAKEN action of the record, in action order. `refs` aligns with the taken actions. */
  recordDecision(rec: DecisionRecord, eventSummary: string, refs: (string | undefined)[] = []): AuditEntry[] {
    const path = rec.conditions.length ? rec.conditions.map((c) => `${c.description} [${c.result ? "true" : "false"}; observed ${String(c.observed)}]`).join(" ; ") : "trigger matched (no conditions)";
    const out: AuditEntry[] = [];
    let i = 0;
    for (const a of rec.actions) {
      if (a.status !== "taken" || a.target === null) continue;
      const ref = refs[i++];
      out.push(this.record({ curse: rec.curse, eventId: rec.eventId, eventSummary, path, kind: a.kind, target: a.target, at: rec.at, ...(ref !== undefined ? { ref } : {}) }));
    }
    return out;
  }

  /** Runs the inverse, then appends a reversal entry. Throws (and appends nothing) if it cannot. */
  reverse(id: string, inverse: Inverse, at: number): AuditEntry {
    const orig = this.get(id);
    if (!orig) throw new UnknownEntryError(`No grimoire entry "${id}".`);
    if (orig.reversalOf !== undefined) throw new NotReversibleError(`Entry "${id}" is itself a reversal.`);
    if (this.isReversed(id)) throw new AlreadyReversedError(`Entry "${id}" is already reversed.`);
    const fn = inverse[orig.kind];
    if (!fn) throw new NotReversibleError(`Action "${orig.kind}" has no inverse on this host.`);
    fn(orig);
    const seq = this.list.length + 1;
    const rev: AuditEntry = Object.freeze({ ...orig, id: `g-${String(seq).padStart(6, "0")}`, seq, at, status: "reversed" as const, reversalOf: orig.id });
    this.list.push(rev);
    return rev;
  }
}
