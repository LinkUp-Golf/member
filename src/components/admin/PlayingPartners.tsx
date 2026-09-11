'use client'

// ============================================================
// Who a member has played with — the other half of the usage
// report. Activity says how much of the app someone opens;
// this says whether it introduced them to anybody.
//
// Fetched on its own rather than folded into the roster: it's
// one member's question, asked only when their panel is open,
// and it reads every booking rather than the activity table.
// ============================================================

import { useState, useEffect } from 'react'
import { Badge } from '@/components/admin/AdminUI'
import { ContentLoader } from '@/components/ui/Loading'
import { format, formatDistanceToNow } from 'date-fns'

export interface PlayingPartner {
  memberId: string
  name: string
  email: string | null
  status: string
  isAdmin: boolean
  courseName: string | null
  /** Rounds already played together. */
  rounds: number
  /** Rounds booked together that haven't happened yet. */
  upcoming: number
  lastPlayed: string | null
  nextRound: string | null
}

/** A round's date has no time. Parsed at local noon, the way the rest of the
 *  app does, so a negative UTC offset can't render it as the day before. */
function roundDay(date: string): Date {
  return new Date(`${date}T12:00:00`)
}

export default function PlayingPartners({ memberId }: { memberId: string }) {
  const [partners, setPartners] = useState<PlayingPartner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetch(`/api/admin/analytics/played-with?memberId=${encodeURIComponent(memberId)}`)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? 'Could not load playing partners.')
        return json as { partners: PlayingPartner[] }
      })
      .then(json => {
        if (cancelled) return
        setPartners(json.partners)
        setError(null)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [memberId])

  if (loading) return <ContentLoader />

  if (error) {
    return <p className="text-sm text-red-500 py-6 text-center">{error}</p>
  }

  if (!partners.length) {
    return (
      <p className="text-sm text-gray-400 italic py-8 text-center">
        Hasn&apos;t shared a round with another member yet.
      </p>
    )
  }

  const played = partners.filter(p => p.rounds > 0).length

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        {partners.length} {partners.length === 1 ? 'member' : 'members'}
        {played < partners.length && (
          <span className="text-gray-400">
            {' '}· {played} played, {partners.length - played} booked but not yet played
          </span>
        )}
      </p>

      <ul className="divide-y divide-gray-50">
        {partners.map(partner => (
          <li key={partner.memberId} className="py-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">{partner.name}</p>
              <p className="text-xs text-gray-400 truncate">
                {partner.courseName ?? partner.email ?? 'No home course'}
              </p>

              {/* Two different facts, and a pair can have both: how long since
                  they last played, and whether they're playing again. */}
              <p className="text-xs text-gray-500 mt-1">
                {partner.lastPlayed ? (
                  <time
                    dateTime={partner.lastPlayed}
                    title={format(roundDay(partner.lastPlayed), 'PP')}
                  >
                    Last played {formatDistanceToNow(roundDay(partner.lastPlayed), { addSuffix: true })}
                  </time>
                ) : (
                  <span className="text-gray-400">Not played yet</span>
                )}
                {partner.nextRound && (
                  <>
                    {' · '}
                    <time
                      dateTime={partner.nextRound}
                      title={format(roundDay(partner.nextRound), 'PP')}
                      className="text-green-800"
                    >
                      Next {format(roundDay(partner.nextRound), 'd MMM')}
                    </time>
                  </>
                )}
              </p>
            </div>

            <Badge
              label={
                partner.rounds > 0
                  ? `${partner.rounds} ${partner.rounds === 1 ? 'round' : 'rounds'}`
                  : 'Upcoming'
              }
              colour={partner.rounds > 0 ? 'green' : 'gray'}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
