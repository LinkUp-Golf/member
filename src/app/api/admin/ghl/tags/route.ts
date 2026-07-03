export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { listLocationTags } from '@/lib/ghl/client'

export const GET = withAuth(
  async () => {
    const tags = await listLocationTags()
    return NextResponse.json({ tags })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
