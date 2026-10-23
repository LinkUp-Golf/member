'use client'

import Link from 'next/link'
import Logo from '@/components/ui/Logo'
import { useUser } from '@/contexts/AuthContext'
import {
  MEMBERSHIP_CHECKOUT_URL,
  MEMBERSHIP_JOIN_URL,
  MY_BOOKINGS_PATH,
} from '@/lib/constants'

// Where a guest lands when they open any part of the app that's for members —
// the middleware and AppNav both send them here (see @/lib/auth/guest-paths).
// Outside the (app) group on purpose: it has no shell to redirect from, and it
// has to be the way back to the few pages that are theirs.
export default function BecomeAMemberPage() {
  const { signOut } = useUser()

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-10 text-center"
      style={{ background: '#002669' }}
    >
      <Logo size={64} className="mb-8" variant="white" />

      <div className="w-full max-w-sm bg-white rounded-3xl px-6 pt-7 pb-6">
        <div className="text-4xl mb-3" aria-hidden="true">⛳</div>
        <h1 className="font-sans font-black text-xl" style={{ color: 'var(--color-green-900)' }}>
          Become a member first
        </h1>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: 'rgba(0,38,105,0.6)' }}>
          You&apos;re here as a guest. LinkUp Golf is a members-only community —
          join to book your own rounds, meet other members and use the rest of
          the app. Your bookings, profile and settings are always open to you.
        </p>

        <div className="mt-6 space-y-2">
          <a
            href={MEMBERSHIP_CHECKOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3.5 rounded-2xl text-sm font-semibold"
            style={{ background: 'var(--color-green-900)', color: 'white' }}
          >
            Become a member
          </a>
          <a
            href={MEMBERSHIP_JOIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3.5 rounded-2xl text-sm font-semibold"
            style={{ background: 'rgba(0,38,105,0.06)', color: 'var(--color-green-900)' }}
          >
            Learn about membership
          </a>
        </div>

        {/* The pages that are theirs */}
        <div
          className="mt-5 pt-4 border-t grid grid-cols-3 gap-2 text-xs font-semibold"
          style={{ borderColor: 'rgba(0,38,105,0.08)' }}
        >
          <Link href={MY_BOOKINGS_PATH} className="py-2 rounded-xl hover:bg-green-50" style={{ color: 'var(--color-green-700)' }}>
            My bookings
          </Link>
          <Link href="/more/profile" className="py-2 rounded-xl hover:bg-green-50" style={{ color: 'var(--color-green-700)' }}>
            Profile
          </Link>
          <Link href="/more/settings" className="py-2 rounded-xl hover:bg-green-50" style={{ color: 'var(--color-green-700)' }}>
            Settings
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={() => signOut()}
        className="mt-6 text-xs font-medium text-white/50 hover:text-white/80"
      >
        Sign out
      </button>
    </div>
  )
}
