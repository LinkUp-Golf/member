// ============================================================
// LinkUp Golf — Rate Limiter
// Simple in-memory sliding window rate limiter.
// For production at scale, replace with Redis (Upstash).
// ============================================================

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key)
  }
}, 5 * 60 * 1000)

interface RateLimitOptions {
  windowMs: number   // Time window in milliseconds
  max: number        // Max requests per window
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function rateLimit(
  identifier: string,
  options: RateLimitOptions = { windowMs: 60_000, max: 20 }
): RateLimitResult {
  const now = Date.now()
  const key = identifier
  const existing = store.get(key)

  if (!existing || existing.resetAt < now) {
    // New window
    const resetAt = now + options.windowMs
    store.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: options.max - 1, resetAt }
  }

  if (existing.count >= options.max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }

  existing.count++
  return { allowed: true, remaining: options.max - existing.count, resetAt: existing.resetAt }
}

// ---- Pre-configured limiters for specific routes ------------

export function authRateLimit(ip: string): RateLimitResult {
  // 5 magic link requests per 15 minutes per IP
  return rateLimit(`auth:${ip}`, { windowMs: 15 * 60_000, max: 5 })
}

export function bookingRateLimit(memberId: string): RateLimitResult {
  // 10 booking attempts per hour per member
  return rateLimit(`booking:${memberId}`, { windowMs: 60 * 60_000, max: 10 })
}

export function apiRateLimit(memberId: string): RateLimitResult {
  // 120 API calls per minute per member (generous for real-time use)
  return rateLimit(`api:${memberId}`, { windowMs: 60_000, max: 120 })
}

export function pushSendRateLimit(callerId: string): RateLimitResult {
  // 10 send calls per minute per caller (admin / cron only)
  return rateLimit(`push-send:${callerId}`, { windowMs: 60_000, max: 10 })
}

export function pushSendToAllRateLimit(callerId: string): RateLimitResult {
  // 2 broadcast calls per hour — prevent accidental spam to all users
  return rateLimit(`push-send-all:${callerId}`, { windowMs: 60 * 60_000, max: 2 })
}

export function messageRateLimit(memberId: string): RateLimitResult {
  // 30 messages per minute per member (global across all conversations)
  return rateLimit(`msg:global:${memberId}`, { windowMs: 60_000, max: 30 })
}

export function messageBurstLimit(memberId: string, convId: string): RateLimitResult {
  // 10 messages per 15 seconds per member per conversation (burst protection)
  return rateLimit(`msg:conv:${memberId}:${convId}`, { windowMs: 15_000, max: 10 })
}

export function inviteRateLimit(memberId: string): RateLimitResult {
  // 10 invitations per hour per member
  return rateLimit(`invite:${memberId}`, { windowMs: 60 * 60_000, max: 10 })
}
