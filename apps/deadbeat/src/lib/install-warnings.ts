import { durationMs, type Curse } from "@curseengine/engine";

const TICK_INTERVAL = { amount: 1, unit: "day" } as const;

/**
 * Install-time warnings for a curse Deadbeat can accept but never run. Deadbeat emits only `tick`
 * events with a fixed 1-day interval (see toTickEvent), matched by interval in milliseconds, so
 * `every 24 hours` fires but `every 1 hour` or `every 7 days` does not. Installs are never refused.
 */
export function installWarnings(curse: Curse): string[] {
  const t = curse.trigger;
  if (t.kind === "event") return [`Trigger can never fire: Deadbeat emits only tick events, so \`when ${t.event}\` is installed but never runs here.`];
  if (t.kind === "webhook") return [`Trigger can never fire: Deadbeat has no webhook intake, so \`on webhook ${t.path}\` is installed but never runs here.`];
  if (durationMs(t.interval) !== durationMs(TICK_INTERVAL)) return ["Trigger can never fire: Deadbeat emits ticks once per day only, so only an interval equal to 1 day (for example `every 1 day` or `every 24 hours`) ever runs here."];
  return [];
}
