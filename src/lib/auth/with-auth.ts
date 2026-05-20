// ============================================================
// withAuth — API route handler HOC.
//
// Wraps a Next.js route handler to enforce:
//   1. Valid Supabase session (JWT not expired)
//   2. Member row exists in our DB
//   3. GHL membership tag still active (15-min cache)
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
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { cookies } from 'next/headers'
import { validateGHLMembership } from './ghl-validator'
import { logger, auditLog } from '@/lib/logger'
import { apiRateLimit } from '@/lib/rateLimit'
import {
  AuthError,
  RateLimitError,
  toErrorResponse,
  ErrorCode,
} from '@/lib/errors/app-error'
import type { AuthContext } from './types'

interface WithAuthOptions {
  /** If true, require is_admin=true on the member row */
  requireAdmin?: boolean
  /** Skip GHL re-validation (use only for low-sensitivity endpoints) */
  skipGHLCheck?: boolean
  /** Override rate limit: requests per minute. Default: 120 */
  rateLimit?: number
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

    // ---- 3. Load member row --------------------------------
    let member: { id: string; ghl_contact_id: string; is_admin: boolean } | null = null
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, ghl_contact_id, is_admin')
        .eq('id', userId)
        .single()

      if (error || !data) {
        authLog.warn('Member row not found', { action: 'member_lookup' })
        auditLog('SESSION_EXPIRED', { requestId, userId })
        throw new AuthError('Member not found', ErrorCode.UNAUTHENTICATED)
      }

      member = data
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
      } catch (err) {
        authLog.error('GHL validation threw unexpectedly', { errorMessage: String(err) })
        // Fail-secure: deny on unexpected errors
        return errorResponse(503, ErrorCode.GHL_UNAVAILABLE, 'Authorization service unavailable', requestId)
      }
    }

    // ---- 6. Build context and execute handler --------------
    const ctx: AuthContext = {
      requestId,
      userId,
      email,
      memberId: member.id,
      ghlContactId: member.ghl_contact_id,
      isAdmin: member.is_admin,
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
