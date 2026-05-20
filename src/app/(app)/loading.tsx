import Header from '@/components/ui/Header'
import { CardSkeleton } from '@/components/ui/Loading'

export default function AppLoading() {
  return (
    <>
      <Header title="LinkUp Golf" description="Member Portal" />
      <div className="px-5 pt-5 space-y-3">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={3} />
      </div>
    </>
  )
}
