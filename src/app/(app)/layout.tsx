import AppNav from '@/components/layout/AppNav'
import ActivityTracker from '@/components/providers/ActivityTracker'
import MatchSurveyGate from '@/components/matching/MatchSurveyGate'

// Server Component — no client JS for this wrapper.
// AppNav (usePathname for active-state), ActivityTracker (records which
// areas a member visits) and MatchSurveyGate (the mandatory matching survey)
// are the only client boundaries.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ActivityTracker />
      <MatchSurveyGate />
      <AppNav>{children}</AppNav>
    </>
  )
}
