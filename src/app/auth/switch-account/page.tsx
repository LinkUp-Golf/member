'use client'

// Shown by /auth/confirm when a login link is opened on a device that is
// already signed in. Verifying the link there would silently replace the
// signed-in account with the link's — an admin opening a member's generated
// link on their own phone lost their own session that way, and was left with
// a browser that disagreed with the server about who was signed in.
//
// The link's single-use token has NOT been spent yet: this page only carries
// the query string through. Three ways on:
//   - copy the link, to open in an Incognito tab or send to the member;
//   - sign out here and continue (back to /auth/confirm with switch=1, which
//     skips the question);
//   - stay signed in as you are.

import { useEffect, useState } from 'react'
import Logo from '@/components/ui/Logo'
import { endSession } from '@/contexts/AuthContext'
import { DEFAULT_LANDING_PATH } from '@/lib/constants'

export default function SwitchAccountPage() {
  // Read from window rather than useSearchParams: this page has nothing to
  // prerender, and it keeps the token out of any server-rendered markup.
  const [query, setQuery] = useState('')
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.delete('switch')
    setQuery(params.toString())

    fetch('/api/members/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((m: { email?: string } | null) => setCurrentEmail(m?.email ?? null))
      .catch(() => {})
  }, [])

  const link = query ? `${window.location.origin}/auth/confirm?${query}` : ''

  async function signOutAndContinue() {
    setSwitching(true)
    await endSession()
    window.location.replace(`/auth/confirm?${query}&switch=1`)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-16" style={{ background: 'var(--color-green-900)' }}>
      <Logo size={96} className="mb-8" variant="on-dark" />

      <div className="w-full max-w-sm text-center">
        <h1 className="font-sans font-black text-2xl text-white mb-3">
          You&apos;re already signed in
        </h1>
        <p className="text-sm text-white/60 leading-relaxed">
          This device is signed in{currentEmail ? <> as <span className="text-white">{currentEmail}</span></> : null}.
          The login link you opened may be for someone else, and opening it here
          would sign you out of your own account.
        </p>

        <div className="mt-8 space-y-3">
          <button
            type="button"
            disabled={!link}
            onClick={() => {
              navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {})
            }}
            className="focus-ring w-full py-3.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-gold)', color: 'var(--color-green-950)' }}
          >
            {copied ? 'Link copied' : 'Copy the link'}
          </button>
          <p className="text-xs text-white/40">
            Paste it into an Incognito tab to see the app as them, or send it to
            the member. Your own sign-in stays as it is.
          </p>

          <button
            type="button"
            disabled={!query || switching}
            onClick={signOutAndContinue}
            className="focus-ring w-full py-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ border: '0.5px solid rgba(255,255,255,0.25)' }}
          >
            {switching ? 'Signing out…' : 'Sign out and continue with this link'}
          </button>

          <a
            href={DEFAULT_LANDING_PATH}
            className="focus-ring block text-xs underline text-white/40 hover:text-white/60 pt-2"
          >
            Cancel, stay signed in
          </a>
        </div>
      </div>
    </div>
  )
}
