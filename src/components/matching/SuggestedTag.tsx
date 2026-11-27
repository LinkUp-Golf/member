'use client'

// "Introduced" beside a member who is one of this member's Curated
// Introductions. A plain label: it used to open a "Why you two" pop-up with
// the admin's note and what the two have in common, but a match carries no
// reason any more (client, 2026-11-24) — members judge each other from the
// profile, which the row already links to.

import { Sparkles } from 'lucide-react'
import type { Recommendation } from '@/hooks/useRecommendations'

export default function SuggestedTag({ recommendation }: { recommendation: Recommendation }) {
  return (
    <span
      aria-label={`${recommendation.member.firstName || 'This member'} is one of your Curated Introductions`}
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: 'var(--color-green-700)', background: 'rgba(133,187,101,0.16)' }}
    >
      <Sparkles className="w-3 h-3" strokeWidth={2.25} aria-hidden />
      Introduced
    </span>
  )
}
