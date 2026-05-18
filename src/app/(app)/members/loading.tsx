import { Skeleton, MemberRowSkeleton, TopBarSkeleton } from '@/components/ui/Loading'

export default function MembersLoading() {
  return (
    <div>
      <TopBarSkeleton />

      {/* Search bar */}
      <div className="px-5 pt-4">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-5 py-3 overflow-hidden">
        {[80, 60, 72, 56, 64].map((w, i) => (
          <Skeleton key={i} className={`h-7 w-${w} flex-shrink-0 rounded-full`} />
        ))}
      </div>

      {/* Member rows */}
      <div className="mx-5 card">
        {Array.from({ length: 8 }).map((_, i) => (
          <MemberRowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
