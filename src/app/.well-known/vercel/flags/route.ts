export const dynamic = 'force-dynamic'

import { createFlagsDiscoveryEndpoint, getProviderData } from 'flags/next'
import * as flags from '../../../../flags'

// createFlagsDiscoveryEndpoint handles auth (verifyAccess) and adds
// the required x-flags-sdk-version response header automatically.
export const GET = createFlagsDiscoveryEndpoint(async () => {
  return getProviderData(flags)
})
