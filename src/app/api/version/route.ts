export const dynamic = 'force-dynamic'

// The build this deployment is running — the commit Vercel built it from.
// UpdateWatcher compares it with the build its own page was loaded with, so a
// tab or installed app left open across a deploy can tell it's running old
// code. Public: the signed-out login page goes stale the same way, and a
// commit hash says nothing a visitor can use.

import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json(
    { build: process.env.VERCEL_GIT_COMMIT_SHA ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
