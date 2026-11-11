import type { Curse } from "@curseengine/engine";

/**
 * Install-time warnings for a curse GrimMod can accept but never run. GrimMod emits only `message`
 * events: no ticks and no webhook intake. Installs are never refused; this only informs the caller.
 */
export function installWarnings(curse: Curse): string[] {
  const t = curse.trigger;
  if (t.kind === "timer") return ["Trigger can never fire: GrimMod emits no tick events, so an `every` curse is installed but never runs here."];
  if (t.kind === "webhook") return [`Trigger can never fire: GrimMod has no webhook intake, so \`on webhook ${t.path}\` is installed but never runs here.`];
  return [];
}
