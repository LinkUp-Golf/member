// ============================================================
// Route gate for the referral-partner workspace.
//
// Wraps withAuth and additionally resolves the caller's own referral_partners
// row, refusing the request when they don't own one. Every /api/partner/*
// handler must scope its queries to ctx.partner.id — that scoping is the only
// thing separating a partner's view from the admin one, so it belongs here
// rather than being re-derived (and possibly forgotten) per route.
//
// Admins do NOT get an implicit pass: /admin already exposes every partner's
// data, and letting an admin's own /api/partner call silently resolve to some
// other partner would make the scoping ambiguous.
// ============================================================

import type { NextRequest, NextResponse } from 'next/server'
import { withAuth } from './with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse as Res } from 'next/server'
import type { AuthContext } from './types'
import type { ReferralPartner } from '@/types'

export interface PartnerAuthContext extends AuthContext {
  /** The referral partner row owned by the caller. */
  partner: ReferralPartner
}

type RouteContext = { params: Record<string, string> }

type PartnerRouteHandler = (
  req: NextRequest,
  ctx: PartnerAuthContext,
  routeCtx?: RouteContext
) => Promise<NextResponse>

export function withPartnerAuth(handler: PartnerRouteHandler) {
  return withAuth(
    async (req: NextRequest, ctx: AuthContext, routeCtx?: RouteContext) => {
      const admin = createAdminClient()

      const { data: partner, error } = await admin
        .from('referral_partners')
        .select('*')
        .eq('member_id', ctx.memberId)
        .maybeSingle()

      if (error) {
        return Res.json({ error: 'Could not verify referral partner access' }, { status: 500 })
      }
      if (!partner) {
        return Res.json({ error: 'You are not a referral partner.' }, { status: 403 })
      }

      return handler(req, { ...ctx, partner: partner as ReferralPartner }, routeCtx)
    },
    // Partners are members in good standing, but these are read-mostly
    // reporting endpoints — skip the live GHL round-trip like the admin
    // referral routes do.
    { skipGHLCheck: true }
  )
}
