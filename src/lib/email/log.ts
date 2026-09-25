// A record of what was actually mailed to whom.
//
// notification_log records what a member was *told*, across both channels and
// including things that never left as email. This records what we handed to
// Resend, which is a smaller set and a different question: it's how you answer
// "has this member been getting too much from us?" — and, if a volume rule is
// ever wanted again, the history to base it on already exists.
//
// Nothing reads it to make a decision today. Emails are not suppressed on
// volume; see ./policy.

import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import type { EmailCategory } from './policy'

/**
 * Records that these members were emailed this notification.
 *
 * Written after the provider accepts it, so a rejected send doesn't appear as
 * one that arrived. Never throws: failing to record is a gap in a log, while
 * failing the caller would cost the notification itself.
 */
export async function recordEmailsSent(
  memberIds: string[],
  key: string,
  category: EmailCategory,
): Promise<void> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return

  const { error } = await createAdminClient()
    .from('email_send_log')
    .insert(ids.map(id => ({ member_id: id, notification_key: key, category })))

  if (error) {
    logger.warn('Could not record email sends', {
      action: 'email.record_failed',
      errorMessage: error.message,
      metadata: { key, category, members: ids.length },
    })
  }
}
