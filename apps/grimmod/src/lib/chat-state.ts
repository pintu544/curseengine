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
