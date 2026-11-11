import type { Invoice } from "./fixtures";

export interface OutboxEntry {
  id: string;
  to: string;
  template: string;
  subject: string;
  body: string;
  invoiceId: string;
  curse: string;
  at: number;
  /** True once the grimoire undo has retracted the message. The entry itself stays in the outbox. */
  retracted: boolean;
}

export interface Escalation {
  id: string;
  curse: string;
  invoiceId: string;
  at: number;
  to: "owner";
  summary: string;
  retracted: boolean;
}

export type InvoiceStatus = "open" | "chased" | "escalated";

export interface InvoiceView extends Invoice {
  status: InvoiceStatus;
  /** Curses that have already acted on this invoice (each at most once). */
  chasedBy: string[];
}

export interface InvoiceSnapshot {
  clock: number;
  invoices: InvoiceView[];
  outbox: OutboxEntry[];
  escalations: Escalation[];
}

const sentKey = (invoiceId: string, curse: string) => `${invoiceId}\u0000${curse}`;

/** In-memory invoice state: invoices, the host clock, the outbox, escalations and sent-tier tracking. */
export class InvoiceState {
  invoices: Invoice[];
  clock: number;
  outbox: OutboxEntry[] = [];
  escalations: Escalation[] = [];
  private readonly sent = new Set<string>();
  /** Invoice the event being processed belongs to (set by the host before each dispatch). */
  currentInvoiceId = "";

  constructor(initial: Invoice[], clock: number) {
    this.invoices = initial.map((i) => ({ ...i }));
    this.clock = clock;
  }

  find(id: string): Invoice | undefined {
    return this.invoices.find((i) => i.id === id);
  }

  /** Has this curse already acted on this invoice? Undo does not clear this (a tier is never re-sent). */
  hasSent(invoiceId: string, curse: string): boolean {
    return this.sent.has(sentKey(invoiceId, curse));
  }

  markSent(invoiceId: string, curse: string): void {
    this.sent.add(sentKey(invoiceId, curse));
  }

  /** Sent-tier keys as stored pairs (for persistence). */
  sentPairs(): [string, string][] {
    return [...this.sent].map((k) => k.split("\u0000") as [string, string]);
  }

  restoreSent(pairs: readonly (readonly [string, string])[]): void {
    this.sent.clear();
    for (const [inv, curse] of pairs) this.markSent(inv, curse);
  }

  addOutbox(e: OutboxEntry): void {
    this.outbox.push(e);
  }

  addEscalation(e: Escalation): void {
    this.escalations.push(e);
  }

  /** Inverse of the email capability: marks the outbox entry retracted. The entry stays. */
  retractEmail(id: string): boolean {
    const e = this.outbox.find((o) => o.id === id);
    if (!e || e.retracted) return false;
    e.retracted = true;
    return true;
  }

  /** Inverse of the escalate capability: marks the escalation retracted. The entry stays. */
  retractEscalation(id: string): boolean {
    const e = this.escalations.find((x) => x.id === id);
    if (!e || e.retracted) return false;
    e.retracted = true;
    return true;
  }

  snapshot(): InvoiceSnapshot {
    const invoices = this.invoices.map((i): InvoiceView => {
      const escalated = this.escalations.some((e) => e.invoiceId === i.id && !e.retracted);
      const chased = this.outbox.some((o) => o.invoiceId === i.id && !o.retracted);
      const chasedBy = [...new Set([...this.outbox.filter((o) => o.invoiceId === i.id && !o.retracted).map((o) => o.curse), ...this.escalations.filter((e) => e.invoiceId === i.id && !e.retracted).map((e) => e.curse)])];
      return { ...i, status: escalated ? "escalated" : chased ? "chased" : "open", chasedBy };
    });
    return { clock: this.clock, invoices, outbox: this.outbox.map((o) => ({ ...o })), escalations: this.escalations.map((e) => ({ ...e })) };
  }
}
