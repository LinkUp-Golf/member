import { Skeleton, TopBarSkeleton } from '@/components/ui/Loading'

export default function MoreLoading() {
  return (
    <div>
      <TopBarSkeleton hasSubtitle={false} />

      {/* Profile card */}
      <div className="px-5 py-4">
        <div className="card card-pad flex items-center gap-4">
          <Skeleton className="w-16 h-16 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-24 rounded-full" />
          </div>
        </div>
      </div>

      {/* Menu sections */}
      {[4, 3].map((count, si) => (
        <div key={si} className="px-5 mb-4">
          <Skeleton className="h-3 w-20 mb-2" />
          <div className="card divide-y divide-green-900/08">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-8 h-8 rounded-lg" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
                <Skeleton className="w-4 h-4 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
