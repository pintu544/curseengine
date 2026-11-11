import type { Capabilities } from "@curseengine/engine";
import type { ChatState } from "./chat-state";

/**
 * Chat adapter: implements the mute, post and escalate capabilities against in-memory chat state.
 * `email` is deliberately left undeclared, so a curse that emails is refused by the sandbox.
 * Every effect is a reversible in-memory record; nothing leaves the process.
 */
export function createChatAdapter(chat: ChatState): Capabilities {
  let seq = 0;
  return {
    mute({ curse, eventId, target, durationMs }) {
      chat.addMute({ author: target, curse, eventId, since: chat.now, until: chat.now + durationMs });
    },
    post({ curse, eventId, message, channel }) {
      seq += 1;
      chat.addMessage({
        id: `sys-${eventId}-${seq}`,
        author: `curse:${curse}`,
        channel,
        text: message,
        at: chat.now,
        flagged: false,
        system: true,
      });
    },
    escalate({ curse, eventId, to }) {
      seq += 1;
      const source = chat.find(eventId);
      chat.addEscalation({
        id: `esc-${eventId}-${seq}`,
        curse,
        eventId,
        at: chat.now,
        to,
        ...(source ? { author: source.author } : {}),
        summary: source
          ? `Curse "${curse}" escalated a message from ${source.author}: "${source.text}"`
          : `Curse "${curse}" escalated event ${eventId}`,
      });
    },
  };
}
