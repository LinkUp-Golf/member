import { Skeleton, MemberRowSkeleton } from '@/components/ui/Loading'

export default function HomeLoading() {
  return (
    <div>
      {/* Top bar */}
      <div className="top-bar">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28 bg-white/10" />
        </div>
      </div>

      {/* Hero banner */}
      <div className="hero-banner space-y-3">
        <Skeleton className="h-3 w-20 bg-white/10" />
        <Skeleton className="h-8 w-48 bg-white/10" />
        <Skeleton className="h-6 w-32 bg-white/10" />
        <div className="mt-4 rounded-xl bg-white/5 h-16 animate-pulse" />
      </div>

      <div className="px-5 pt-5 space-y-6 pb-6">
        {/* Community section */}
        <section>
          <Skeleton className="h-3 w-24 mb-3" />
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="card card-pad flex gap-3 items-start">
                <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Member spotlight */}
        <section>
          <Skeleton className="h-3 w-32 mb-3" />
          <div className="card">
            <MemberRowSkeleton />
            <MemberRowSkeleton />
          </div>
        </section>

        {/* Promotions */}
        <section>
          <Skeleton className="h-3 w-24 mb-3" />
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-green-950)' }}>
            <div className="h-0.5 animate-pulse" style={{ background: 'rgba(133,187,101,0.3)' }} />
            <div className="p-4 space-y-2">
              <Skeleton className="h-3 w-20 bg-white/10" />
              <Skeleton className="h-5 w-48 bg-white/10" />
              <Skeleton className="h-3 w-full bg-white/10" />
              <Skeleton className="h-3 w-3/4 bg-white/10" />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
