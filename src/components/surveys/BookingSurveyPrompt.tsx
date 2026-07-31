'use client'

import { useBookingSurvey } from '@/hooks/useBookingSurvey'
import { useProfile } from '@/hooks/useProfile'
import BookingSurveySheet from './BookingSurveySheet'

// ============================================================
// The automatic post-round prompt. Mounted once at the app shell so it can
// appear on whatever screen the member is on when their round finishes.
//
// This component is only the trigger — useBookingSurvey decides *when* (a live
// timer on the booking's own clock) and BookingSurveySheet is the form. My
// Bookings renders the same sheet for rounds a member chooses to rate later.
// ============================================================

export default function BookingSurveyPrompt() {
  const { profile } = useProfile()
  const { active, complete, snooze } = useBookingSurvey(!!profile)

  return (
    <BookingSurveySheet
      target={active}
      onDismiss={() => active && snooze(active.booking_id)}
      onSubmitted={complete}
      dismissLabel="Not now"
    />
  )
}
