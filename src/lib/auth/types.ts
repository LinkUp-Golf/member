// ============================================================
// Auth + authorization types shared across the system.
// ============================================================

export interface AuthContext {
  /** Correlation ID for tracing a single request end-to-end */
  requestId: string
  /** Supabase auth user UUID */
  userId: string
  /** Authenticated email address */
  email: string
  /** Supabase member row ID (same as userId) */
  memberId: string
  /** GHL contact ID for this member */
  ghlContactId: string
  /** Whether the member has is_admin=true in the members table */
  isAdmin: boolean
  /** The member's home course ID — null for members not yet assigned a course */
  homeCourseId: string | null
}

export interface GHLAuthorizationResult {
  authorized: boolean
  /** GHL tags at the time of validation */
  tags: string[]
  /** Human-readable reason for denial (server-only, not sent to client) */
  reason?: string
  /** True if result was served from cache */
  fromCache: boolean
  /** Epoch ms when the check was performed */
  checkedAt: number
}

/** Subset stored in the authorization cache */
export interface CachedAuthResult {
  authorized: boolean
  tags: string[]
  checkedAt: number
}
