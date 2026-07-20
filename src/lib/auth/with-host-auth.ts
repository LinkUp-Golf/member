// ============================================================
// Route gate for the host workspace.
//
// Wraps withAuth and additionally resolves the caller's own hosts row, refusing
// the request when they don't own one. Every /api/host/* handler must scope its
// queries to ctx.host.id — that scoping is the only thing separating a host's
// view from the admin one, so it belongs here rather than being re-derived (and
// possibly forgotten) per route.
//
// Admins do NOT get an implicit pass: /admin already exposes every host's data,
// and letting an admin's own /api/host call silently resolve to some other host
// would make the scoping ambiguous. Mirrors withPartnerAuth.
// ============================================================

import type { NextRequest, NextResponse } from 'next/server'
import { withAuth } from './with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse as Res } from 'next/server'
import type { AuthContext } from './types'
import type { Host } from '@/types'

export interface HostAuthContext extends AuthContext {
  /** The host row owned by the caller. */
  host: Host
}

type RouteContext = { params: Record<string, string> }

type HostRouteHandler = (
  req: NextRequest,
  ctx: HostAuthContext,
  routeCtx?: RouteContext
) => Promise<NextResponse>

export function withHostAuth(handler: HostRouteHandler) {
  return withAuth(
    async (req: NextRequest, ctx: AuthContext, routeCtx?: RouteContext) => {
      const admin = createAdminClient()

      // A suspended host keeps their row but loses workspace access — the
      // status check must live here too, not just on the row's existence,
      // otherwise "suspend" would be a control that does nothing.
      const { data: host, error } = await admin
        .from('hosts')
        .select('*')
        .eq('member_id', ctx.memberId)
        .eq('status', 'active')
        .maybeSingle()

      if (error) {
        return Res.json({ error: 'Could not verify host access' }, { status: 500 })
      }
      if (!host) {
        return Res.json({ error: 'You are not a host.' }, { status: 403 })
      }

      return handler(req, { ...ctx, host: host as Host }, routeCtx)
    },
    // Hosts are members in good standing, but these are read-mostly workspace
    // endpoints — skip the live GHL round-trip like the partner routes do.
    { skipGHLCheck: true }
  )
}
