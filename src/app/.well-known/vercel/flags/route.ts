export const dynamic = 'force-dynamic'

// Vercel Toolbar feature-flag discovery endpoint (RFC 8615 well-known URI).
// The toolbar fetches /.well-known/vercel/flags to discover registered flags.
// Flag definitions are not sensitive — this endpoint is intentionally public.

import { getProviderData } from '@vercel/flags/next'
import { focusLinkupsFlag } from '@/flags'
import type { NextRequest } from 'next/server'

export async function GET(_request: NextRequest) {
  return Response.json(
    getProviderData({ focusLinkupsFlag })
  )
}
