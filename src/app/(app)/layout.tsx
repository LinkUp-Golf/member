import AppNav from '@/components/layout/AppNav'
import ActivityTracker from '@/components/providers/ActivityTracker'
import { CancellationPolicyProvider } from '@/components/providers/CancellationPolicyProvider'
import { stripeEnabled } from '@/lib/stripe/config'

// Server Component — no client JS for this wrapper.
// AppNav (usePathname for active-state), ActivityTracker (records which
// areas a member visits) and CancellationPolicyProvider (whether late
// cancellations are invoiced, read here on the server) are the only client
// boundaries.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CancellationPolicyProvider enabled={stripeEnabled()}>
      <ActivityTracker />
      <AppNav>{children}</AppNav>
    </CancellationPolicyProvider>
  )
}
