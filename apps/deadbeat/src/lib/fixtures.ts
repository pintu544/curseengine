/**
 * Demo fixtures only. No real services, no real people, no real email addresses (`.invalid` is a reserved TLD).
 *
 * FIXTURE CONTRACT (same discipline as GrimMod)
 * - Stable ids: invoices are `inv-001`..`inv-005`, clients `cli-001`..`cli-005`, simulation ticks `sim-tick-inv-NNN`.
 *   Ids never depend on the clock or on load order.
 * - Fixed reference clock: `REFERENCE_NOW` (2026-11-11T12:00:00Z). At that clock the invoices are 3, 8, 15, 22 and 40
 *   days overdue.
 * - Refresh is a FULL DEMO RESET: it rebuilds the invoices at the reference clock and installs the three tier curses,
 *   and discards all live state (outbox, escalations, grimoire, decisions, sent-tier tracking, user-installed curses).
 *   POST /api/fixtures says so in its response (`reset: true`).
 * - Idempotent: refreshing twice gives identical state and identical simulation results.
 * - The SIMULATION history is separate from live state: one tick per invoice at the reference clock.
 */

export interface Invoice {
  id: string;
  clientId: string;
  clientName: string;
  /** Address the `email ... to client` action uses. */
  clientEmail: string;
  /** Amount due in pounds sterling. */
  amount: number;
  daysOverdue: number;
}

export const DAY_MS = 86_400_000;

/** Reference clock for fixtures: 2026-11-11T12:00:00Z. */
export const REFERENCE_NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

/** Tier 1 (>= 7 days): polite nudge. */
export const LATE_PAYERS_CURSE = "curse late-payers: every 1 day where days_overdue >= 7 -> email polite-nudge to client";
/** Tier 2 (>= 14 days): firmer reminder. */
export const LATE_PAYERS_FIRM_CURSE = "curse late-payers-firm: every 1 day where days_overdue >= 14 -> email firm-reminder to client";
/** Tier 3 (>= 21 days): escalate to the owner. */
export const LATE_PAYERS_ESCALATE_CURSE = "curse late-payers-escalate: every 1 day where days_overdue >= 21 -> escalate to owner";

export const EXAMPLE_CURSE = LATE_PAYERS_CURSE;
export const TIER_CURSES: readonly string[] = [LATE_PAYERS_CURSE, LATE_PAYERS_FIRM_CURSE, LATE_PAYERS_ESCALATE_CURSE];

/** Live demo invoices at the reference clock. Stable ids. */
export function fixtureInvoices(): Invoice[] {
  const row = (n: number, clientName: string, slug: string, amount: number, daysOverdue: number): Invoice => ({
    id: `inv-${String(n).padStart(3, "0")}`,
    clientId: `cli-${String(n).padStart(3, "0")}`,
    clientName,
    clientEmail: `accounts@${slug}.invalid`,
    amount,
    daysOverdue,
  });
  return [
    row(1, "Harbour Bakery", "harbour-bakery", 240, 3),
    row(2, "Lindqvist Joinery", "lindqvist-joinery", 1250, 8),
    row(3, "Northgate Print", "northgate-print", 780.5, 15),
    row(4, "Ashdown Studio", "ashdown-studio", 3400, 22),
    row(5, "Pemberton Cycles", "pemberton-cycles", 615, 40),
  ];
}

/** Simulation history: one tick per fixture invoice at the reference clock (a "what would run now" snapshot). */
export function simulationInvoices(): Invoice[] {
  return fixtureInvoices();
}
