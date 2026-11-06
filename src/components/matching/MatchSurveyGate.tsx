'use client'

// ============================================================
// The matching survey is mandatory. Mounted once in the (app)
// layout: a member of a club who hasn't completed it gets the
// survey over the whole app, with no way to dismiss it, until it's
// submitted. Matchmaking is built from these answers, and a
// preference nobody stated is one the admin can't honour.
//
// Who must take it is the server's call (GET /api/match-survey,
// requiresMatchSurvey) — guests, partners and hosts without a golf
// membership are never asked. If that read fails the gate stays
// open rather than shut: a broken endpoint must not lock every
// member out of their bookings.
// ============================================================

import { useEffect, useState } from 'react'
import { useProfile } from '@/hooks/useProfile'
import MatchSurveyForm from '@/components/matching/MatchSurveyForm'
import type { SurveyAnswers } from '@/lib/matching/survey'

interface SurveyStatus {
  required: boolean
  completed: boolean
  answers: SurveyAnswers
}

export default function MatchSurveyGate() {
  const { user, refetch } = useProfile()
  const [status, setStatus] = useState<SurveyStatus | null>(null)
  const userId = user?.id

  useEffect(() => {
    // Another account's answer must not carry over to this one.
    setStatus(null)
    if (!userId) return
    let cancelled = false
    fetch('/api/match-survey')
      .then(res => (res.ok ? res.json() : null))
      .then((json: SurveyStatus | null) => { if (!cancelled) setStatus(json) })
      .catch(() => { if (!cancelled) setStatus(null) })
    return () => { cancelled = true }
  }, [userId])

  const open = Boolean(status?.required && !status.completed)

  // The page behind doesn't scroll while the survey covers it.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  if (!open || !status) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center md:items-center md:p-6"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-survey-title"
    >
      <div
        data-scroll-root
        className="relative bg-white w-full h-full md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-3xl shadow-float overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)]"
      >
        <MatchSurveyForm
          mode="gate"
          initial={status.answers}
          onSaved={() => {
            setStatus({ ...status, completed: true })
            // What they offer and seek was saved onto the profile too.
            void refetch()
          }}
        />
      </div>
    </div>
  )
}
