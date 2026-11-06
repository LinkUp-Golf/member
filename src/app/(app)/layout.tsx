import AppNav from '@/components/layout/AppNav'
import ActivityTracker from '@/components/providers/ActivityTracker'
import MatchSurveyGate from '@/components/matching/MatchSurveyGate'
import { StripeKeyProvider } from '@/components/providers/StripeKeyProvider'
import { stripePublishableKey } from '@/lib/stripe/config'

// Server Component — no client JS for this wrapper.
// AppNav (usePathname for active-state), ActivityTracker (records which
// areas a member visits), MatchSurveyGate (the mandatory matching survey) and
// StripeKeyProvider (the publishable key, read here on the server so it isn't
// compiled into the public bundle) are the only client boundaries.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StripeKeyProvider publishableKey={stripePublishableKey()}>
      <ActivityTracker />
      <MatchSurveyGate />
      <AppNav>{children}</AppNav>
    </StripeKeyProvider>
  )
}
