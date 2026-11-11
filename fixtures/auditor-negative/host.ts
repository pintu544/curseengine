// SEEDED FIXTURE — a GrimMod-style host, deliberately defective. NOT production code.
// GrimMod-style: emits `message` events only, NEVER sends tick events.
// Declared capabilities: message (post), mute, escalate. (email is NOT declared.)
export const fixtureHost = {
  name: "grimmod-style-fixture",
  events: ["message"],
  sendsTicks: false,
  declaredCapabilities: ["post", "mute", "escalate"],
  // Inverse registry (mirrors chatInverse in a real host).
  // PLANTED DEFECT: `escalate` has no inverse here, so an escalation taken by
  // this host can never be reversed from the grimoire.
  inverses: {
    mute: "unmute",
    post: "retract",
    // escalate: intentionally missing
  },
};
