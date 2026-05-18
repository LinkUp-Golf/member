'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

const REASONS: Record<string, { title: string; body: string }> = {
  no_code: {
    title: 'Invalid link',
    body: 'This login link is missing required information. Please request a new link from the login page.',
  },
  invalid_code: {
    title: 'Link expired or already used',
    body: 'Login links are single-use and expire after 1 hour. Please request a new link to continue.',
  },
  access_denied: {
    title: 'Access not active',
    body: 'Your LinkUp Golf membership is not currently active. Please contact your LinkUp coordinator if you believe this is an error.',
  },
  default: {
    title: 'Something went wrong',
    body: 'We couldn\'t complete your login. Please try again from the login page.',
  },
}

export default function AuthErrorPage() {
  const searchParams = useSearchParams()
  const reason = searchParams.get('reason') ?? 'default'
  const DEFAULT_REASON = { title: 'Something went wrong', body: "We couldn't complete your login. Please try again from the login page." }
  const { title, body } = REASONS[reason] ?? DEFAULT_REASON

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center"
      style={{ background: '#002669' }}>
      <div className="font-serif text-3xl italic mb-8" style={{ color: '#85bb65' }}>
        LinkUp Golf
      </div>

      <div className="text-4xl mb-5">🔒</div>

      <h1 className="font-serif text-2xl text-white mb-3">{title}</h1>
      <p className="text-sm text-white/50 leading-relaxed max-w-xs mb-8">{body}</p>

      <Link
        href="/login"
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold"
        style={{ background: '#85bb65', color: '#002669' }}
      >
        Back to login
      </Link>

      <p className="text-xs text-white/20 mt-8 leading-relaxed">
        Need help? Contact your LinkUp Golf coordinator.
      </p>
    </div>
  )
}
