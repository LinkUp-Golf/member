'use client'

// ============================================================
// A member's Curated Introductions (GET /api/recommendations): photo,
// name, title and company, and Message / Invite to a round / Not now.
// No reason is shown — members judge each other from the profile,
// which the card links to (client, 2026-11-24). The queue on More →
// Curated Introductions lists them all; Members shows them all too,
// and Home the newest, with a link to the queue.
//
// Members and Home render nothing until there's something to show.
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { MessageCircle, CalendarPlus, ChevronRight } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import { useRecommendations, type Recommendation } from '@/hooks/useRecommendations'

function RecommendationCard({
  rec,
  onDismissed,
}: {
  rec: Recommendation
  onDismissed: (id: string) => void
}) {
  const [dismissing, setDismissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const m = rec.member
  const role = [m.roleTitle, m.businessName].filter(Boolean).join(', ')

  async function dismiss() {
    setDismissing(true)
    setError(null)
    const res = await fetch(`/api/recommendations/${rec.id}/dismiss`, { method: 'POST' }).catch(() => null)
    if (res?.ok) {
      onDismissed(rec.id)
      return
    }
    setError('Could not hide this. Please try again.')
    setDismissing(false)
  }

  return (
    <article className="card card-pad space-y-3.5">
      <Link href={`/members/${m.id}`} className="focus-ring flex items-center gap-3 rounded-xl -m-1 p-1">
        <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-green-950">{m.name}</p>
          <p className="text-xs text-green-900/50 truncate">
            {[role, m.industry].filter(Boolean).join(' · ')}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 flex-shrink-0 text-green-900/20" strokeWidth={1.75} />
      </Link>


      <div className="grid grid-cols-2 gap-2">
        <Link href={`/messages/new?with=${m.id}`} className="btn btn-primary btn-sm justify-center">
          <MessageCircle className="w-3.5 h-3.5" strokeWidth={2} /> Message
        </Link>
        <Link href={`/book?invite=${m.id}`} className="btn btn-outline btn-sm justify-center">
          <CalendarPlus className="w-3.5 h-3.5" strokeWidth={2} /> Invite to a round
        </Link>
        <button
          type="button"
          onClick={dismiss}
          disabled={dismissing}
          className="col-span-2 text-xs font-medium text-green-900/45 hover:text-green-900/70 py-1 disabled:opacity-60"
        >
          {dismissing ? <Spinner className="w-3.5 h-3.5 mx-auto" /> : 'Not now'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 text-center">{error}</p>}
    </article>
  )
}

// `queue` is the home of a member's introductions: the top of More → Curated
// Introductions, where the "new match" notification opens. Members and Home
// show the same cards as shortcuts; Home links to the queue for the rest.
export default function RecommendedPartners({ variant }: { variant: 'members' | 'home' | 'queue' }) {
  const { recommendations: recs, loaded, remove } = useRecommendations()

  if (recs.length === 0) {
    if (variant !== 'queue' || !loaded) return null
    return (
      <section aria-labelledby="recommended-queue" className="card card-pad">
        <p id="recommended-queue" className="section-label">Your introductions</p>
        <p className="text-sm text-green-900/60">
          No introductions right now. When the LinkUp team matches you with someone, they&apos;ll appear here and we&apos;ll let you know.
        </p>
      </section>
    )
  }

  const shown = variant === 'home' ? recs.slice(0, 1) : recs

  return (
    <section aria-labelledby={`recommended-${variant}`}>
      <div className="flex items-center justify-between mb-3.5">
        <p id={`recommended-${variant}`} className="section-label !mb-0">
          {variant === 'queue' ? 'Your introductions' : 'Your Curated Introductions'}
        </p>
        {variant === 'home' && recs.length > 1 && (
          <Link href="/more/match-profile" className="focus-ring text-xs font-semibold rounded-lg" style={{ color: 'var(--color-green-600)' }}>
            See all {recs.length} →
          </Link>
        )}
      </div>
      <div className={variant === 'home' ? 'space-y-2.5' : 'grid gap-3 md:grid-cols-2'}>
        {shown.map(rec => <RecommendationCard key={rec.id} rec={rec} onDismissed={remove} />)}
      </div>
    </section>
  )
}
