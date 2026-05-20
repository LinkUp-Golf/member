import { Skeleton } from '@/components/ui/Loading'

// Shown by Next.js App Router inside the (app) layout's Suspense boundary
// while a route segment's JS chunk or data is loading. The nav shell
// (sidebar + bottom nav) remains visible immediately — only this content
// area streams in.
export default function AppLoading() {
  return (
    <div className="p-5 space-y-4">
      <Skeleton className="h-8 w-40" />
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  )
}
