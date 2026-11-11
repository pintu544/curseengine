import { AuditLog, type AuditEntry, type Inverse } from "@curseengine/engine";
import type { InvoiceState } from "./invoice-state";

/**
 * Repository interface for the grimoire. Kept in memory (the engine AuditLog); the Postgres store (src/lib/persistence.ts) now persists it append-only and
 * replays it on boot, behind the same interface. Append-only within a host's lifetime: no update or delete.
 */
export type GrimoireRepository = Pick<AuditLog, "entries" | "get" | "isReversed" | "record" | "recordDecision" | "reverse">;

/**
 * Rebuilds a grimoire from stored entries (oldest first) by replaying them through the engine's own append-only API:
 * originals are recorded, reversals are re-appended with a no-op inverse (the effect is already part of the restored
 * state). Throws if the replay does not reproduce the stored ids, which would mean the stored history is inconsistent.
 */
export function replayEntries(log: GrimoireRepository, stored: readonly AuditEntry[]): void {
  for (const e of [...stored].sort((a, b) => a.seq - b.seq)) {
    const made = e.reversalOf !== undefined
      ? log.reverse(e.reversalOf, { [e.kind]: () => undefined } as Inverse, e.at)
      : log.record({ curse: e.curse, eventId: e.eventId, eventSummary: e.eventSummary, path: e.path, kind: e.kind, target: e.target, at: e.at, ...(e.ref !== undefined ? { ref: e.ref } : {}) });
    if (made.id !== e.id || made.seq !== e.seq) throw new Error(`Stored grimoire entry ${e.id} does not replay cleanly.`);
  }
}

export const createGrimoire = (): GrimoireRepository => new AuditLog();

/**
 * Inverses for the mail adapter's actions. Undoing an email marks the outbox entry retracted (the entry stays,
 * and the grimoire gains a reversal entry). Undoing an escalation marks it retracted in the same way.
 */
export function mailInverse(state: InvoiceState): Inverse {
  return {
    email: (e) => { if (!e.ref || !state.retractEmail(e.ref)) throw new Error("outbox message no longer exists or is already retracted"); },
    escalate: (e) => { if (!e.ref || !state.retractEscalation(e.ref)) throw new Error("escalation no longer exists or is already retracted"); },
  };
}

/** What the API and UI show: the entry plus derived flags (history itself is never edited). */
export interface GrimoireView extends AuditEntry {
  reversed: boolean;
  reversible: boolean;
}

/** Email and escalate entries are reversible here (unlike GrimMod, where email is undeclared). */
export function viewOf(log: GrimoireRepository): GrimoireView[] {
  return log.entries.map((e) => ({
    ...e,
    reversed: log.isReversed(e.id),
    reversible: e.status === "applied" && (e.kind === "email" || e.kind === "escalate") && !log.isReversed(e.id),
  }));
}

/** Shown in the UI and returned by GET /api/grimoire. */
export const UNDO_NOTE =
  "Undoing an email marks its outbox message as retracted; the message and the grimoire entry stay, and a reversal entry is appended. An undone tier is not sent again for that invoice.";
