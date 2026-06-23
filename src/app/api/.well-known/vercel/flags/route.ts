export const dynamic = 'force-dynamic'

// Vercel Toolbar feature-flag registration endpoint.
// The toolbar hits this route to discover all declared flags and their
// current values / options. Secured by FLAGS_SECRET (set in Vercel env).
// https://vercel.com/docs/workflow-collaboration/feature-flags

import { getProviderData } from '@vercel/flags/next'
import { focusLinkupsFlag } from '@/flags'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  const flagsSecret = process.env.FLAGS_SECRET

  // In production, FLAGS_SECRET must be set and match the Authorization header.
  // In development without a secret, allow unauthenticated access for convenience.
  if (flagsSecret && authHeader !== `Bearer ${flagsSecret}`) {
    return Response.json(null, { status: 401 })
  }

  return Response.json(
    getProviderData({ focusLinkupsFlag })
  )
}
