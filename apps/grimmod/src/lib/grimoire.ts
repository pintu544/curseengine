import { AuditLog, type AuditEntry, type Inverse } from "@curseengine/engine";
import { parseMuteRef } from "./adapter";
import type { ChatState } from "./chat-state";

/**
 * Repository interface for the grimoire. Slice 2 keeps it in memory (the engine AuditLog);
 * a Postgres (Neon) implementation can replace it at deploy time without touching callers.
 * Append-only: there is no update or delete.
 */
export type GrimoireRepository = Pick<AuditLog, "entries" | "get" | "isReversed" | "record" | "recordDecision" | "reverse">;

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
