// When a message is worth an email as well as a push.
//
// Not every message. A conversation is a burst — ten messages in four minutes
// is a normal exchange, and ten emails about it is how a member learns to
// filter us. But a message that arrives while someone is away from the app is
// exactly the thing they'd want to hear about, and a push they never saw is
// gone the moment they clear the notification shade.
//
// The rule is the one every chat app settles on: email the message that breaks
// the silence, not the ones that follow it. A recipient who was caught up gets
// an email; a recipient who already has something unread in this conversation
// has already been told, so the next nine messages are push-only. Reading the
// conversation arms it again.
//
// This is pure so the rule can be tested. The route supplies the two facts.

export interface MessageEmailInput {
  /** When this recipient last read the conversation. Null: never opened it. */
  lastReadAt: string | null
  /**
   * When the message before this one was sent, or null when the one just sent
   * is the first in the conversation.
   */
  previousMessageAt: string | null
}

/**
 * True when this recipient had nothing unread before the message just sent.
 *
 * Note what happens to someone who has never opened the conversation: they're
 * emailed about the first message and then not again until they read it. That
 * is deliberate — one unanswered email is an invitation, five is a complaint.
 */
export function shouldEmailForMessage({
  lastReadAt,
  previousMessageAt,
}: MessageEmailInput): boolean {
  // The first message in a conversation always breaks a silence.
  if (!previousMessageAt) return true

  // Never opened it, and there's already history they haven't seen.
  if (!lastReadAt) return false

  const read = Date.parse(lastReadAt)
  const previous = Date.parse(previousMessageAt)

  // An unparseable timestamp shouldn't cost someone a notification; treat it
  // as caught up and send. A duplicate email is a smaller failure than a
  // message nobody hears about.
  if (Number.isNaN(read) || Number.isNaN(previous)) return true

  return read >= previous
}

export interface MessageRecipient {
  memberId: string
  lastReadAt: string | null
}

/** The subset of recipients this message should also be emailed to. */
export function recipientsToEmail(
  recipients: MessageRecipient[],
  previousMessageAt: string | null,
): string[] {
  return recipients
    .filter(r => shouldEmailForMessage({ lastReadAt: r.lastReadAt, previousMessageAt }))
    .map(r => r.memberId)
}
