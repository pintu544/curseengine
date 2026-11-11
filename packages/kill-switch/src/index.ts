/** Name of the FR9 kill switch environment variable. `0`, `false` or `off` (any case) disables the engine. */
export const ENGINE_ENABLED_ENV = "CURSE_ENGINE_ENABLED";

/** Reads the kill switch from the environment: on unless explicitly set to 0, false or off. */
export function engineEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const v = env[ENGINE_ENABLED_ENV]?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/** Thrown at event intake while the FR9 kill switch is off. Nothing has been advanced, recorded or executed. */
export class EngineDisabledError extends Error {
  constructor() {
    super(`The curse engine is disabled (kill switch: ${ENGINE_ENABLED_ENV}=off). Nothing was processed and no action, email, escalation or grimoire entry was produced.`);
    this.name = "EngineDisabledError";
  }
}
