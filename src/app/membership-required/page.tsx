'use client'

import Link from 'next/link'

// Shown when:
//  - GHL tag missing at callback (membership revoked after link was sent)
//  - API returns 403 MEMBERSHIP_REVOKED (caught by global interceptor)
export default function MembershipRequiredPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-8 text-center"
      style={{ background: '#002669' }}
    >
      <div className="font-display text-4xl mb-8" style={{ color: '#85bb65' }}>
        LinkUp Golf
      </div>

      <div className="text-5xl mb-6">🔒</div>

      <h1 className="font-display text-2xl text-white mb-3">
        Membership Required
      </h1>

      <p className="text-sm text-white/50 leading-relaxed max-w-xs mb-8">
        Your account does not have an active LinkUp Golf membership.
        If you believe this is an error, please contact your coordinator.
      </p>

      <Link
        href="/login"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
        style={{ background: '#85bb65', color: '#002669' }}
      >
        Back to login
      </Link>

      <p className="text-xs text-white/20 mt-10 leading-relaxed max-w-xs">
        LinkUp Golf is a private, invitation-only community.
        <br />
        Membership is by referral only.
      </p>
    </div>
  )
}
