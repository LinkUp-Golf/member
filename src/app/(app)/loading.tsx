import { TopBarSkeleton, CardSkeleton } from '@/components/ui/Loading'

export default function AppLoading() {
  return (
    <div>
      <TopBarSkeleton />
      <div className="px-5 pt-5 space-y-3">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={3} />
      </div>
    </div>
  )
}
