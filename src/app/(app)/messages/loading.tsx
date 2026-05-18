import { Skeleton, TopBarSkeleton } from '@/components/ui/Loading'

export default function MessagesLoading() {
  return (
    <div>
      <TopBarSkeleton />

      <div className="divide-y divide-green-900/08">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-4">
            <Skeleton className="w-11 h-11 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <div className="flex justify-between">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
