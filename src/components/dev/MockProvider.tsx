'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { AuthContext } from '@/contexts/AuthContext'
import { ProfileContext } from '@/contexts/ProfileContext'
import { mockCurrentUser } from '@/mocks/data'
import type { MemberWithProfile } from '@/types'

// Seeds auth and profile contexts with fixture data so all pages render
// without a real Supabase session. MSW intercepts API calls and returns
// fixture responses.
//
// In the layout, MockProvider is the outer wrapper and SessionProvider is
// inside it. SessionProvider skips its real providers when isMock=true, so
// the AuthContext / ProfileContext values set here propagate uncontested.
//
// layout.tsx tree-shakes this module out of production bundles via the
// dynamic() branch that replaces it with a pass-through component.
export default function MockProvider({ children }: { children: React.ReactNode }) {
  const isMockEnabled =
    process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_MOCK !== 'false'

  if (!isMockEnabled) return <>{children}</>

  return <MockModeWrapper>{children}</MockModeWrapper>
}

function MockModeWrapper({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function init() {
      const { worker } = await import('@/mocks/browser')
      await worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
      })
      setReady(true)
    }
    init().catch(console.error)
  }, [])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <p className="text-green-900/40 text-sm font-sans">Starting mock server…</p>
      </div>
    )
  }

  const mockUser = {
    id: mockCurrentUser.id,
    email: mockCurrentUser.email,
  } as User

  return (
    <AuthContext.Provider
      value={{
        user: mockUser,
        loading: false,
        signOut: async () => { window.location.href = '/login' },
      }}
    >
      <ProfileContext.Provider
        value={{
          profile: mockCurrentUser as MemberWithProfile,
          loading: false,
          error: null,
          refetch: async () => {},
        }}
      >
        {children}
      </ProfileContext.Provider>
    </AuthContext.Provider>
  )
}
