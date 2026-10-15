// Added players: who pays for their seat, and their answer to the invitation.
//
// A booker adding someone to a round says, for each player, whether they're
// paying for that seat ('booker') or the player pays their own ('self'). It is
// required — there is no default, because either guess is someone's money.
// The choice is stored on the player's row as bookings.paid_by_booker.
//
// The player is then invited: their row opens at invite_status 'pending', and
// they accept or decline from the invitation screen. A decline cancels the row,
// which frees the seat. The booker hears either way.
//
// Pure, so the booking screen, the admin booking form, both booking routes and
// the invitation screen all read the same rules.

export type PaidBy = 'booker' | 'self'
export type InviteStatus = 'pending' | 'accepted' | 'declined'
export type InviteResponse = 'accept' | 'decline'

/** What the server says when an added player arrives without a choice. */
export const PAID_BY_REQUIRED_MESSAGE =
  'Choose who pays for each added player — you, or the player themselves.'

export function isPaidBy(value: unknown): value is PaidBy {
  return value === 'booker' || value === 'self'
}

export function isInviteResponse(value: unknown): value is InviteResponse {
  return value === 'accept' || value === 'decline'
}

/** The two choices, as the booking forms offer them. */
export const PAID_BY_OPTIONS: ReadonlyArray<{ value: PaidBy; label: string }> = [
  { value: 'booker', label: "I'll pay" },
  { value: 'self', label: 'They pay' },
]

/** How the invited player is told who's paying. */
export function paidByLabel(paidByBooker: boolean, bookerName?: string | null): string {
  if (!paidByBooker) return "You'll pay for your own round"
  return bookerName ? `${bookerName} is paying for your round` : 'Your round is paid for by the booker'
}

/** The short tag beside a player on the booker's own card. */
export function paidByShortLabel(paidByBooker: boolean): string {
  return paidByBooker ? 'You pay' : 'Pays own'
}

/** How the booker sees a player's answer. Null for a row nobody was asked about. */
export function inviteStatusLabel(status: InviteStatus | null | undefined): string | null {
  if (status === 'pending') return 'Invite pending'
  if (status === 'accepted') return 'Accepted'
  if (status === 'declined') return 'Declined'
  return null
}

/** Whether an invitation can still be answered. */
export function canRespondToInvite(params: {
  inviteStatus: InviteStatus | null | undefined
  bookingStatus: string
  /** 'YYYY-MM-DD' of the round. */
  bookingDate: string
  /** 'YYYY-MM-DD' today. */
  today: string
}): boolean {
  if (params.inviteStatus !== 'pending') return false
  if (params.bookingStatus === 'cancelled') return false
  return params.bookingDate >= params.today
}

export interface NextStep {
  step: string
  detail?: string
}

const ARRIVAL_DETAIL =
  'Introductions are made 15 minutes prior to first group tee time, so please arrive at least 30 minutes before first group tee time and be at the starter area 15 minutes prior.'

/**
 * "What happens next", as the booking confirmation and the invitation screen
 * both show it. The second step is the payment one, and it depends on who's
 * paying: a player whose booker covers them has nothing to pay, so for them it
 * reads "Arrive and play".
 */
export function whatHappensNext(paidByBooker = false): NextStep[] {
  return [
    { step: 'Receive confirmation email and reminder emails' },
    paidByBooker
      ? { step: 'Arrive and play', detail: ARRIVAL_DETAIL }
      : { step: 'Pay at the pro shop when you arrive', detail: ARRIVAL_DETAIL },
  ]
}
