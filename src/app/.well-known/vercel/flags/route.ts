export const dynamic = 'force-dynamic'

import { verifyAccess } from '@vercel/flags'
import { getProviderData } from '@vercel/flags/next'
import { focusLinkupsFlag } from '../../../../flags'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const access = await verifyAccess(request.headers.get('Authorization'))
  if (!access) return Response.json(null, { status: 401 })

  return Response.json({ version: 1, ...getProviderData({ focusLinkupsFlag }) })
}
