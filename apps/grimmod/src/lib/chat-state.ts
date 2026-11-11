import type { ChatMessage } from "./fixtures";

export interface MuteEntry {
  author: string;
  curse: string;
  eventId: string;
  since: number;
  until: number;
}

export interface Escalation {
  id: string;
  curse: string;
  eventId: string;
  at: number;
  to: "owner";
  /** Author of the triggering message, when known. */
  author?: string;
  summary: string;
}

/** In-memory chat state: messages, mutes with expiry, owner escalations. */
export class ChatState {
  messages: ChatMessage[] = [];
  mutes: MuteEntry[] = [];
  escalations: Escalation[] = [];
  /** Host clock for the event being processed (set by the host). */
  now = 0;

  constructor(initial: ChatMessage[] = []) {
    this.messages = initial.map((m) => ({ ...m }));
  }

  isMuted(author: string, at: number = this.now): boolean {
    return this.mutes.some((m) => m.author === author && m.since <= at && at < m.until);
  }

  muteOf(author: string, at: number = this.now): MuteEntry | undefined {
    return this.mutes.find((m) => m.author === author && m.since <= at && at < m.until);
  }

  /** Records a message; it is marked muted if the author is muted when it arrives. */
  addMessage(msg: Omit<ChatMessage, "muted">): ChatMessage {
    const stored: ChatMessage = { ...msg, muted: !msg.system && this.isMuted(msg.author, msg.at) };
    this.messages.push(stored);
    return stored;
  }

  addMute(entry: MuteEntry): void {
    this.mutes.push(entry);
  }

  addEscalation(e: Escalation): void {
    this.escalations.push(e);
  }

  /**
   * Inverse of addMute: removes one mute entry (the first matching author, curse and triggering event).
   * Takes effect immediately. Returns false when no such mute exists.
   */
  liftMute(author: string, curse: string, eventId: string): boolean {
    const i = this.mutes.findIndex((m) => m.author === author && m.curse === curse && m.eventId === eventId);
    if (i < 0) return false;
    this.mutes.splice(i, 1);
    return true;
  }

  /** Inverse of the post capability: retracts a curse-posted message by id. */
  retractMessage(id: string): boolean {
    const i = this.messages.findIndex((m) => m.id === id && m.system === true);
    if (i < 0) return false;
    this.messages.splice(i, 1);
    return true;
  }

  /** Inverse of the escalate capability: retracts an escalation by id. */
  retractEscalation(id: string): boolean {
    const i = this.escalations.findIndex((e) => e.id === id);
    if (i < 0) return false;
    this.escalations.splice(i, 1);
    return true;
  }

  find(id: string): ChatMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  snapshot(): ChatSnapshot {
    return {
      messages: this.messages.map((m) => ({ ...m })),
      mutes: this.mutes.map((m) => ({ ...m })),
      escalations: this.escalations.map((e) => ({ ...e })),
    };
  }
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  mutes: MuteEntry[];
  escalations: Escalation[];
}
