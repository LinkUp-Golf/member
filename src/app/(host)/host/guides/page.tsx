'use client'

// Host video guides — the whole set in one place.
//
// Lives in the host workspace rather than the member app's More menu so a host
// never has to leave the workspace to find out how it works, and so a host who
// isn't a golf member (they exist — earning credit needs no membership) can
// still reach it.
//
// The list is the catalogue in @/lib/tutorials, in journey order. Each video is
// also linked from the screen it explains; this page is for the host who wants
// to watch them before doing any of it.

import { AdminPageHeader, AdminCard } from '@/components/admin/AdminUI'
import { TutorialCard } from '@/components/tutorials/TutorialPlayer'
import { tutorialsFor } from '@/lib/tutorials'

export default function HostGuidesPage() {
  const guides = tutorialsFor('host')

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <AdminPageHeader
        title="Guides"
        description="Short walkthroughs of hosting, start to finish."
      />

      {guides.length === 0 ? (
        <AdminCard>
          <p className="py-10 text-center text-sm text-gray-400 italic">
            No guides yet — they&apos;ll appear here as we record them.
          </p>
        </AdminCard>
      ) : (
        /* Dividers rather than separate cards: three rows read as one list, and
           this list is meant to be watched in order. */
        <section className="card overflow-hidden divide-y divide-gray-100">
          {guides.map(g => (
            <TutorialCard key={g.id} tutorial={g} />
          ))}
        </section>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Each guide is also linked from the screen it covers, so you can watch it
        while you&apos;re there.
      </p>
    </div>
  )
}
