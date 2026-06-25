export const dynamic = 'force-dynamic'

// Vercel Toolbar feature-flag registration endpoint.
// The toolbar hits this route to discover all declared flags and their
// current values / options. Secured by FLAGS_SECRET (set in Vercel env).
// https://vercel.com/docs/workflow-collaboration/feature-flags

import { createFlagsDiscoveryEndpoint, getProviderData } from 'flags/next'
import * as flags from '../../../../../flags'

export const GET = createFlagsDiscoveryEndpoint(async () => {
  return getProviderData(flags)
})
