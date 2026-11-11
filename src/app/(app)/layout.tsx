import AppNav from '@/components/layout/AppNav'
import ActivityTracker from '@/components/providers/ActivityTracker'
import MatchSurveyGate from '@/components/matching/MatchSurveyGate'
import { CancellationPolicyProvider } from '@/components/providers/CancellationPolicyProvider'
import { stripeEnabled } from '@/lib/stripe/config'

// Server Component — no client JS for this wrapper.
// AppNav (usePathname for active-state), ActivityTracker (records which
// areas a member visits), MatchSurveyGate (the mandatory matching survey) and
// CancellationPolicyProvider (whether late cancellations are invoiced, read
// here on the server) are the only client boundaries.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CancellationPolicyProvider enabled={stripeEnabled()}>
      <ActivityTracker />
      <MatchSurveyGate />
      <AppNav>{children}</AppNav>
    </CancellationPolicyProvider>
  )
}
