import Header from '@/components/ui/Header'
import { Skeleton } from '@/components/ui/Loading'

export default function BookLoading() {
  return (
    <>
      <Header title="Book" description="Park Hyatt Aviara" />

      <div className="flex border-b border-green-900/08 bg-white">
        <div className="flex-1 py-3 flex justify-center">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex-1 py-3 flex justify-center">
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      <div className="px-5 pt-4 pb-6">
        <Skeleton className="h-3 w-24 mb-3" />

        <div className="flex gap-2 overflow-hidden pb-1 mb-5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="flex-shrink-0 w-[52px] h-16 rounded-xl" />
          ))}
        </div>

        <Skeleton className="h-3 w-40 mb-3" />

        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
          <div className="py-2">
            <Skeleton className="h-3 w-20 mx-auto rounded-full" />
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </>
  )
}
