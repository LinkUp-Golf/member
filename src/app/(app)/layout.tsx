import AppNav from '@/components/layout/AppNav'
import ActivityTracker from '@/components/providers/ActivityTracker'

// Server Component — no client JS for this wrapper.
// AppNav (usePathname for active-state) and ActivityTracker (records which
// areas a member visits) are the only client boundaries.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ActivityTracker />
      <AppNav>{children}</AppNav>
    </>
  )
}
