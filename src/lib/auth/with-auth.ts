// ============================================================
// withAuth — API route handler HOC.
//
// Wraps a Next.js route handler to enforce:
//   1. Valid Supabase session (JWT not expired)
//   2. Member row exists in our DB
//   3. GHL membership tag still active (15-min cache)
//   4. A guest (isGuestOnly) only reaches routes marked allowGuests
//   5. A former member (@/lib/auth/former-member) keeps the app, less the
//      members-only parts, until their last round, then nothing
//
// Usage:
//   export const GET = withAuth(async (req, ctx) => {
//     // ctx.userId, ctx.email, ctx.ghlContactId, ctx.isAdmin
//     return NextResponse.json({ ok: true })
//   })
//
//   export const POST = withAuth(
//     async (req, ctx) => { ... },
//     { requireAdmin: true }  // optional
//   )
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient, createRouteHandlerClient } from '@/lib/supabase-server'
import { cookies } from 'next/headers'
import { invalidateMembershipCache, validateGHLMembership } from './ghl-validator'
import { logger, auditLog } from '@/lib/logger'
import { apiRateLimit } from '@/lib/rateLimit'
import {
  AuthError,
  RateLimitError,
  toErrorResponse,
  ErrorCode,
} from '@/lib/errors/app-error'
import { getCache } from '@/lib/cache'
import { MEMBER_ROW_NS, MEMBER_ROW_TTL_MS, memberRowKey } from '@/lib/cache/keys'
import { isGuestOnly } from '@/lib/ghl/tags'
import { getContactByIdStrict } from '@/lib/ghl/client'
import { syncMember } from '@/lib/sync'
import {
  formerMemberAccessUntil,
  isApiClosedToFormerMember,
  isFormerMember,
  membershipChanged,
} from './former-member'
import type { AuthContext } from './types'

// Shape stored in the member row cache
interface CachedMemberRow {
  ghl_contact_id: string
  is_admin: boolean
  home_course_id: string | null
  ghl_tags: string[]
  membership_status: string | null
}

type MemberRow = { id: string } & CachedMemberRow

interface WithAuthOptions {
  /** If true, require is_admin=true on the member row */
  requireAdmin?: boolean
  /** Skip GHL re-validation (use only for low-sensitivity endpoints) */
  skipGHLCheck?: boolean
  /** Override rate limit: requests per minute. Default: 120 */
  rateLimit?: number
  /**
   * Let a guest — signed in without a membership, see isGuestOnly — through.
   * Off by default: a route is members-only unless it says otherwise. Set it
   * only on what a guest's own screens need (their bookings, their invitation,
   * their profile and settings) and on what the app shell calls on every page.
   * The overlay in the member app is presentation; this is the gate.
   */
  allowGuests?: boolean
}

type RouteContext = { params: Record<string, string> }

type RouteHandler = (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: RouteContext
) => Promise<NextResponse>

export function withAuth(
  handler: RouteHandler,
  options: WithAuthOptions = {}
): (req: NextRequest, routeCtx?: RouteContext) => Promise<NextResponse> {
  return async (req: NextRequest, routeCtx?: RouteContext): Promise<NextResponse> => {
    const requestId = randomUUID()
    const reqLog = logger.child({ requestId, path: req.nextUrl.pathname, method: req.method })

    // ---- 1. Supabase session validation --------------------
    let userId: string
    let email: string
    let supabase: ReturnType<typeof createRouteHandlerClient>

    try {
      supabase = createRouteHandlerClient(cookies())
      const { data: { user }, error } = await supabase.auth.getUser()

      if (error || !user) {
        reqLog.debug('No valid session', { action: 'auth_check' })
        throw new AuthError('No active session', ErrorCode.UNAUTHENTICATED)
      }

      userId = user.id
      email = user.email ?? ''
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse(err.statusCode, err.code, err.message, requestId)
      }
      reqLog.error('Session validation threw', { errorMessage: String(err) })
      return errorResponse(500, ErrorCode.INTERNAL_ERROR, 'Internal error', requestId)
    }

    const authLog = reqLog.child({ userId })

    // ---- 2. Per-member rate limiting -----------------------
    const limit = apiRateLimit(userId)
    if (!limit.allowed) {
      authLog.warn('Rate limit exceeded', { action: 'rate_limit' })
      throw new RateLimitError(Math.ceil((limit.resetAt - Date.now()) / 1000))
    }

    // ---- 3. Load member row (cached 5 min) -----------------
    // Also fetches home_course_id so downstream routes don't
    // need a second DB query for the same field.
    let member: MemberRow | null = null
    try {
      const memberCache = getCache(MEMBER_ROW_NS)
      const cached = await memberCache.get<CachedMemberRow>(memberRowKey(userId))

      // An entry cached before ghl_tags or membership_status was part of it is
      // treated as a miss: the guest and former-member checks need both.
      if (cached && Array.isArray(cached.ghl_tags) && 'membership_status' in cached) {
        member = { id: userId, ...cached }
      } else {
        member = await loadMemberRow(supabase, userId)
        if (!member) {
          authLog.warn('Member row not found', { action: 'member_lookup' })
          auditLog('SESSION_EXPIRED', { requestId, userId })
          throw new AuthError('Member not found', ErrorCode.UNAUTHENTICATED)
        }
      }
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse(err.statusCode, err.code, err.message, requestId)
      }
      authLog.error('Member lookup failed', { errorMessage: String(err) })
      return errorResponse(500, ErrorCode.INTERNAL_ERROR, 'Internal error', requestId)
    }

    // ---- 4. Admin check ------------------------------------
    if (options.requireAdmin && !member.is_admin) {
      authLog.warn('Admin access denied', { action: 'admin_check' })
      auditLog('ADMIN_ACCESS_DENIED', { requestId, userId })
      return errorResponse(403, ErrorCode.UNAUTHORIZED, 'Insufficient privileges', requestId)
    }

    // ---- 5. GHL membership re-validation -------------------
    // The tags the guest check reads: GHL's own, live, when this route checks
    // GHL; the member row's mirror of them when it doesn't.
    let tags = member.ghl_tags
    if (!options.skipGHLCheck) {
      try {
        const ghlResult = await validateGHLMembership({
          userId,
          ghlContactId: member.ghl_contact_id,
          requestId,
        })

        if (!ghlResult.authorized) {
          authLog.warn('GHL membership invalid', {
            action: 'ghl_auth_check',
            ghlContactId: member.ghl_contact_id,
            metadata: { reason: ghlResult.reason },
          })
          auditLog('AUTH_TAG_REVOKED', {
            requestId, userId, ghlContactId: member.ghl_contact_id,
          })
          return errorResponse(403, ErrorCode.MEMBERSHIP_REVOKED, 'Membership no longer active', requestId)
        }
        tags = ghlResult.tags
      } catch (err) {
        authLog.error('GHL validation threw unexpectedly', { errorMessage: String(err) })
        // Fail-secure: deny on unexpected errors
        return errorResponse(503, ErrorCode.GHL_UNAVAILABLE, 'Authorization service unavailable', requestId)
      }
    }

    // ---- 6. Catch up with a tag change GHL hasn't told us about ----
    // The member row is updated by the GHL webhook and the nightly reconcile.
    // When the live tags say a membership began or ended since, sync now: the
    // row is what the member directory and the former-member rule read, and
    // neither should wait for the webhook or the night.
    if (!options.skipGHLCheck && membershipChanged(member.ghl_tags, tags)) {
      const resynced = await resyncMember(supabase, userId, member.ghl_contact_id, requestId)
      if (resynced) member = resynced
    }

    // ---- 7. Former members: their remaining rounds, then nothing ----
    if (isFormerMember(member)) {
      let until: string | null
      try {
        until = await formerMemberAccessUntil(supabase, userId)
      } catch (err) {
        // Not a refusal: a read blip mustn't sign someone out of a round
        // they still have. They can try again.
        authLog.error('Former member access check failed', { errorMessage: String(err) })
        return errorResponse(503, ErrorCode.INTERNAL_ERROR, 'Please try again', requestId)
      }
      if (!until) {
        authLog.info('Former member with no round ahead: access ended', { action: 'former_member_check' })
        auditLog('AUTH_TAG_REVOKED', {
          requestId, userId, ghlContactId: member.ghl_contact_id, metadata: { reason: 'membership_ended' },
        })
        return errorResponse(403, ErrorCode.MEMBERSHIP_REVOKED, 'Membership no longer active', requestId)
      }
      if (isApiClosedToFormerMember(req.nextUrl.pathname, req.method)) {
        authLog.warn('Former member denied a members-only route', { action: 'former_member_check' })
        return errorResponse(403, ErrorCode.MEMBERSHIP_REQUIRED, 'Membership required', requestId)
      }
    } else if (!options.allowGuests && !member.is_admin && isGuestOnly(tags)) {
      // Guests reach only what's open to them. The member app hides everything
      // else behind an overlay, but an overlay is a div — remove it and the
      // page underneath works. This is what doesn't.
      authLog.warn('Guest denied a members-only route', { action: 'guest_check' })
      return errorResponse(403, ErrorCode.MEMBERSHIP_REQUIRED, 'Membership required', requestId)
    }

    // ---- 8. Build context and execute handler --------------
    const ctx: AuthContext = {
      requestId,
      userId,
      email,
      memberId: member.id,
      ghlContactId: member.ghl_contact_id,
      isAdmin: member.is_admin,
      homeCourseId: member.home_course_id,
    }

    try {
      const response = await handler(req, ctx, routeCtx)
      // Attach correlation ID to every response
      response.headers.set('X-Request-Id', requestId)
      return response
    } catch (err) {
      const { code, message, statusCode } = toErrorResponse(err)
      authLog.error('Handler threw', { errorCode: code, errorMessage: message })
      return errorResponse(statusCode, code, message, requestId)
    }
  }
}

// ---- Admin-only shorthand -----------------------------------
export function withAdminAuth(handler: RouteHandler): (req: NextRequest) => Promise<NextResponse> {
  return withAuth(handler, { requireAdmin: true })
}

// ---- Member row ---------------------------------------------

/** Reads the member row withAuth needs and caches it for MEMBER_ROW_TTL_MS. */
async function loadMemberRow(
  supabase: ReturnType<typeof createRouteHandlerClient>,
  userId: string,
): Promise<MemberRow | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id, ghl_contact_id, is_admin, home_course_id, ghl_tags, membership_status')
    .eq('id', userId)
    .single()
  if (error || !data) return null

  // Cache only the fields we need — not the full row
  const toCache: CachedMemberRow = {
    ghl_contact_id: data.ghl_contact_id,
    is_admin: data.is_admin,
    home_course_id: data.home_course_id,
    ghl_tags: data.ghl_tags ?? [],
    membership_status: data.membership_status ?? null,
  }
  await getCache(MEMBER_ROW_NS).set(memberRowKey(userId), toCache, MEMBER_ROW_TTL_MS).catch(() => {})
  return { id: userId, ...toCache }
}

/**
 * Re-syncs the member from GHL and returns the fresh row. Best-effort: on any
 * failure the request goes on with the row it had, and the webhook or the
 * nightly reconcile catches up.
 */
async function resyncMember(
  supabase: ReturnType<typeof createRouteHandlerClient>,
  userId: string,
  ghlContactId: string,
  requestId: string,
): Promise<MemberRow | null> {
  try {
    const contact = await getContactByIdStrict(ghlContactId)
    if (!contact) return null
    const result = await syncMember({ contact, userId, ctx: { supabase: createAdminClient(), requestId } })
    if (!result.success) return null
    await invalidateMembershipCache(userId)
    await getCache(MEMBER_ROW_NS).delete(memberRowKey(userId)).catch(() => {})
    return await loadMemberRow(supabase, userId)
  } catch (err) {
    logger.warn('Member resync from withAuth failed', { requestId, userId, errorMessage: String(err) })
    return null
  }
}

// ---- Error response helper ----------------------------------
function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'X-Request-Id': requestId } }
  )
}
