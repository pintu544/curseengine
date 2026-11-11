import { AuditLog, type AuditEntry, type Inverse } from "@curseengine/engine";
import type { InvoiceState } from "./invoice-state";

/**
 * Repository interface for the grimoire. Kept in memory (the engine AuditLog); a database implementation could
 * replace it later without touching callers. Append-only within a host's lifetime: no update or delete.
 */
export type GrimoireRepository = Pick<AuditLog, "entries" | "get" | "isReversed" | "record" | "recordDecision" | "reverse">;

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
