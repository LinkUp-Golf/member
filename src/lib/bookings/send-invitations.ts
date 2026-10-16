// Sends each added player their invitation to a round.
//
// One notification per row rather than one to the group: the invitation says
// who's paying for *that* seat and opens *that* row's answer screen. A row with
// no player_member_id has nobody to send to — a non-member guest whose
// provisioning failed — and is skipped; they're still on the round.
//
// Never throws: like every notify* call, a failed invitation must not fail the
// booking that produced it.

import { NotificationTemplates } from '@/lib/push'
import { notifyMember } from '@/lib/notify'

export interface InvitedRow {
  id: string
  player_member_id: string | null
  paid_by_booker: boolean | null
}

export async function sendBookingInvitations(
  rows: InvitedRow[],
  round: {
    bookerFirstName: string
    eventName: string
    /** Already formatted for reading, e.g. "Saturday, October 18". */
    displayDate: string
    /** Already formatted for reading, e.g. "1:30 PM". */
    displayTime: string
  },
): Promise<void> {
  await Promise.all(
    rows
      .filter(r => r.player_member_id)
      .map(r =>
        notifyMember(
          r.player_member_id as string,
          NotificationTemplates.bookingInvite(
            round.bookerFirstName || 'A member',
            round.eventName,
            round.displayDate,
            round.displayTime,
            r.paid_by_booker === true,
            r.id,
          ),
        ).catch(() => {}),
      ),
  )
}
