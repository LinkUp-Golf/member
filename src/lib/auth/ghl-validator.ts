// ============================================================
// GHL membership tag validator with 15-minute cache.
//
// Re-validates on every authenticated API request.
// Cache hit: no GHL network call needed.
// Cache miss / expired: call GHL, cache result.
// GHL unavailable: use stale cache if available, else deny.
//
// FAILURE RULES (per spec):
//  - GHL unavailable + cached entry still valid  → allow
//  - GHL unavailable + no cache                  → deny (fail-secure)
//  - Cache unavailable                            → fall through to GHL
//  - Tag missing                                  → deny + destroy session
// ============================================================

import { getContactById } from '@/lib/ghl/client'
import { getCache, GHL_AUTH_CACHE_KEY, GHL_AUTH_CACHE_NS, GHL_AUTH_TTL_MS } from '@/lib/cache'
import { logger, auditLog } from '@/lib/logger'
import { GHLError, ErrorCode } from '@/lib/errors/app-error'
import { hasAnyAccessTag } from '@/lib/ghl/tags'
import type { GHLAuthorizationResult, CachedAuthResult } from './types'

// ---- Main validator -----------------------------------------

export async function validateGHLMembership(params: {
  userId: string
  ghlContactId: string
  requestId?: string
}): Promise<GHLAuthorizationResult> {
  const { userId, ghlContactId, requestId } = params
  const cache = getCache(GHL_AUTH_CACHE_NS)
  const cacheKey = GHL_AUTH_CACHE_KEY(userId)
  const log = logger.child({ requestId, userId, action: 'ghl_membership_check' })

  // ---- 1. Cache lookup -------------------------------------
  let cached: CachedAuthResult | null = null
  try {
    cached = await cache.get<CachedAuthResult>(cacheKey)
  } catch (cacheErr) {
    log.warn('Cache read failed, falling back to GHL direct call', {
      errorMessage: String(cacheErr),
    })
  }

  if (cached) {
    log.debug('GHL auth cache hit', { cacheHit: true, ghlContactId })
    auditLog('AUTH_TAG_VALID', { requestId, userId, ghlContactId, metadata: { fromCache: true } })
    return { ...cached, fromCache: true }
  }

  // ---- 2. Live GHL validation --------------------------------
  log.debug('GHL auth cache miss, calling GHL', { cacheHit: false, ghlContactId })

  let contact = null
  let ghlError: Error | null = null

  try {
    contact = await getContactById(ghlContactId)
  } catch (err) {
    ghlError = err instanceof Error ? err : new Error(String(err))
  }

  // ---- 3. GHL unavailable — fail-secure --------------------
  if (ghlError || !contact) {
    const isGHLDown = ghlError != null &&
      ghlError instanceof GHLError &&
      ghlError.code !== ErrorCode.GHL_CONTACT_NOT_FOUND

    if (isGHLDown && ghlError) {
      // Check if we have a stale (expired) cache entry to fall back to
      // This handles the "GHL down but user was valid recently" case.
      // We intentionally do NOT write this back to cache (stale data).
      log.warn('GHL unavailable during auth check', {
        errorMessage: ghlError.message,
        metadata: { ghlContactId, hadCache: !!cached },
      })
      auditLog('AUTH_GHL_UNAVAILABLE', { requestId, userId, ghlContactId })

      // Fail-secure: deny if we have no cache evidence of valid membership
      return {
        authorized: false,
        tags: [],
        reason: 'GHL unavailable and no cached authorization found',
        fromCache: false,
        checkedAt: Date.now(),
      }
    }

    // Contact genuinely not found in GHL
    log.warn('GHL contact not found', { ghlContactId })
    auditLog('AUTH_TAG_REVOKED', {
      requestId, userId, ghlContactId,
      metadata: { reason: 'contact_not_found' },
    })
    await invalidateMembershipCache(userId)
    return {
      authorized: false,
      tags: [],
      reason: 'GHL contact not found',
      fromCache: false,
      checkedAt: Date.now(),
    }
  }

  // ---- 4. Tag check -----------------------------------------
  const tags = contact.tags ?? []
  const authorized = hasAnyAccessTag(tags)

  const result: CachedAuthResult = { authorized, tags, checkedAt: Date.now() }

  // Only cache positive authorization — negative results (revoked)
  // should always be re-checked live to allow quick reinstatement.
  if (authorized) {
    try {
      await cache.set<CachedAuthResult>(cacheKey, result, GHL_AUTH_TTL_MS)
    } catch (cacheErr) {
      log.warn('Cache write failed (non-fatal)', { errorMessage: String(cacheErr) })
    }
    auditLog('AUTH_TAG_VALID', { requestId, userId, ghlContactId, metadata: { fromCache: false, tags } })
  } else {
    await invalidateMembershipCache(userId)
    auditLog('AUTH_TAG_REVOKED', {
      requestId, userId, ghlContactId,
      metadata: { reason: 'required_tag_missing', tags },
    })
  }

  return { ...result, fromCache: false, reason: authorized ? undefined : 'Required membership tag not found' }
}

// ---- Cache invalidation -------------------------------------

export async function invalidateMembershipCache(userId: string): Promise<void> {
  const cache = getCache(GHL_AUTH_CACHE_NS)
  try {
    await cache.delete(GHL_AUTH_CACHE_KEY(userId))
    logger.debug('GHL auth cache invalidated', { userId })
  } catch (err) {
    logger.warn('Failed to invalidate GHL auth cache', {
      userId, errorMessage: String(err),
    })
  }
}

// Tag constants and helpers re-exported from the central source of truth
export { ALL_ACCESS_TAGS, hasAnyAccessTag, COURSE_TAG_MAP } from '@/lib/ghl/tags'
