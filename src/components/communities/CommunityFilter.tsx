'use client'

// The community (location) filter on /book and the member directory.
//
// Greg (2026-11-28): members may look at any community by changing this
// filter, but there's only one community today, so it's shown greyed out —
// built in now, switched on when a second community exists. Until then it
// filters nothing; `enabled` is false while there's one community.
//
// Communities come from GET /api/communities. None (not migrated, or the read
// failed) renders nothing.

import { useEffect, useState } from 'react'

interface CommunityOption {
  id: string
  name: string
  slug: string
}

let cached: CommunityOption[] | null = null

export default function CommunityFilter({ layout = 'section' }: { layout?: 'section' | 'inline' }) {
  const [communities, setCommunities] = useState<CommunityOption[]>(cached ?? [])

  useEffect(() => {
    if (cached) return
    let live = true
    fetch('/api/communities')
      .then(r => (r.ok ? r.json() : { communities: [] }))
      .then((d: { communities?: CommunityOption[] }) => {
        cached = d.communities ?? []
        if (live) setCommunities(cached)
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  if (communities.length === 0) return null

  // One community: nothing to choose yet.
  const enabled = communities.length > 1
  const hint = enabled ? null : 'More communities coming soon'

  const chips = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Community">
      {communities.map((c, i) => (
        <button
          key={c.id}
          type="button"
          disabled={!enabled}
          aria-pressed={i === 0}
          title={hint ?? undefined}
          className={`chip ${i === 0 ? 'active' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {c.name}
        </button>
      ))}
    </div>
  )

  if (layout === 'inline') {
    return (
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-semibold" style={{ color: 'rgba(0,38,105,0.45)' }}>
          Community
        </span>
        {chips}
        {hint && (
          <span className="text-xs" style={{ color: 'rgba(0,38,105,0.35)' }}>
            {hint}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold mb-2.5" style={{ color: 'rgba(0,38,105,0.45)' }}>
        Community
      </p>
      {chips}
      {hint && (
        <p className="text-xs mt-2" style={{ color: 'rgba(0,38,105,0.4)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}
