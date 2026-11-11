import type { Capabilities } from "@curseengine/engine";
import type { InvoiceState } from "./invoice-state";

/** Subject and body text for the templates a curse can name. Unknown names get a plain fallback. */
const TEMPLATES: Record<string, (inv: { clientName: string; id: string; amount: number; daysOverdue: number }) => { subject: string; body: string }> = {
  "polite-nudge": (i) => ({
    subject: `A gentle reminder about invoice ${i.id}`,
    body: `Hello ${i.clientName}, invoice ${i.id} for £${i.amount.toFixed(2)} is now ${i.daysOverdue} days overdue. If it has already been paid, thank you and please ignore this note.`,
  }),
  "firm-reminder": (i) => ({
    subject: `Overdue: invoice ${i.id} needs payment`,
    body: `Hello ${i.clientName}, invoice ${i.id} for £${i.amount.toFixed(2)} is ${i.daysOverdue} days overdue. Please arrange payment this week or get in touch to agree a plan.`,
  }),
};

/**
 * Mail adapter: implements `email` and `escalate` against in-memory invoice state.
 * `email` only appends to the in-app OUTBOX. Nothing is ever sent: no SMTP, no HTTP, no network.
 * `mute` and `post` are deliberately undeclared, so a curse that uses them is refused by the sandbox.
 */
export function createMailAdapter(state: InvoiceState, onEffect: (ref: string) => void = () => undefined): Capabilities {
  let seq = 0;
  return {
    email({ curse, eventId, template, to }) {
      seq += 1;
      const id = `out-${eventId}-${seq}`;
      const inv = state.find(state.currentInvoiceId);
      const text = (TEMPLATES[template] ?? ((i) => ({ subject: `Message about invoice ${i.id}`, body: `Template "${template}" for ${i.clientName}.` })))(
        inv ?? { clientName: "client", id: state.currentInvoiceId, amount: 0, daysOverdue: 0 },
      );
      state.addOutbox({ id, to, template, subject: text.subject, body: text.body, invoiceId: state.currentInvoiceId, curse, at: state.clock, retracted: false });
      onEffect(id);
    },
    escalate({ curse, eventId, to }) {
      seq += 1;
      const id = `esc-${eventId}-${seq}`;
      const inv = state.find(state.currentInvoiceId);
      state.addEscalation({
        id,
        curse,
        invoiceId: state.currentInvoiceId,
        at: state.clock,
        to,
        summary: inv
          ? `Curse "${curse}" escalated invoice ${inv.id} (${inv.clientName}, £${inv.amount.toFixed(2)}, ${inv.daysOverdue} days overdue)`
          : `Curse "${curse}" escalated event ${eventId}`,
        retracted: false,
      });
      onEffect(id);
    },
  };
}
