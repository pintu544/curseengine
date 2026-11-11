import { AuditLog, type AuditEntry, type Inverse } from "@curseengine/engine";
import { parseMuteRef } from "./adapter";
import type { ChatState } from "./chat-state";

/**
 * Repository interface for the grimoire. Slice 2 keeps it in memory (the engine AuditLog);
 * the Postgres store (src/lib/persistence.ts) writes the same entries append-only and replays them on boot.
 * Append-only within a host's lifetime: there is no update or delete; a fixture reset starts a new host lifetime.
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

/** Inverses for the chat adapter's actions. `email` is never declared in GrimMod, so it has none. */
export function chatInverse(chat: ChatState): Inverse {
  return {
    mute: (e) => {
      const [author, curse, eventId] = parseMuteRef(e.ref ?? "[]");
      if (!chat.liftMute(author, curse, eventId)) throw new Error("mute no longer exists");
    },
    post: (e) => { if (!e.ref || !chat.retractMessage(e.ref)) throw new Error("posted message no longer exists"); },
    escalate: (e) => { if (!e.ref || !chat.retractEscalation(e.ref)) throw new Error("escalation no longer exists"); },
  };
}

/** What the API and UI show: the entry plus derived flags (history itself is never edited). */
export interface GrimoireView extends AuditEntry {
  reversed: boolean;
  reversible: boolean;
}

export function viewOf(log: GrimoireRepository): GrimoireView[] {
  return log.entries.map((e) => ({ ...e, reversed: log.isReversed(e.id), reversible: e.status === "applied" && e.kind !== "email" && !log.isReversed(e.id) }));
}

/** Shown in the UI and returned by GET /api/grimoire. */
export const MUTED_NOTE =
  "Messages from a muted author arrive marked as muted and are never fed to the curses: they produce no decision and no grimoire entry. They are listed separately as 'suppressed while muted'; nothing is fabricated.";
