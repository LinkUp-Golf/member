export const dynamic = 'force-dynamic'

// Vercel Toolbar feature-flag registration endpoint.
// The toolbar hits this route to discover all declared flags and their
// current values / options. Secured by FLAGS_SECRET (set in Vercel env).
// https://vercel.com/docs/workflow-collaboration/feature-flags

import { getProviderData } from '@vercel/flags/next'
import { focusLinkupsFlag } from '@/flags'
import type { NextRequest } from 'next/server'

// Flag definitions are not sensitive — this endpoint is intentionally public.
// Override security is handled by the encrypted vercel-flag-overrides cookie (FLAGS_SECRET).
export async function GET(_request: NextRequest) {
  return Response.json(
    getProviderData({ focusLinkupsFlag })
  )
}
