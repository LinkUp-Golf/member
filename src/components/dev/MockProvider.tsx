'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { mockCurrentUser, MOCK_COURSE_ID } from '@/mocks/data'

// Seeds the auth store with mock data so all pages render without a real session.
// MSW intercepts Supabase REST API calls and returns fixture data.
// layout.tsx excludes this module from production bundles via dead-code elimination.
// This guard is defence-in-depth only.
export default function MockProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const isMockEnabled = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_MOCK !== 'false'

  useEffect(() => {
    if (!isMockEnabled) return
    async function init() {
      // Start MSW service worker
      const { worker } = await import('@/mocks/browser')
      await worker.start({
        onUnhandledRequest: 'bypass', // Let unmatched requests through (fonts, images, etc.)
        serviceWorker: { url: '/mockServiceWorker.js' },
      })

      // Seed auth store directly — Supabase JS won't call /auth/v1/user
      // without a stored JWT, so we bypass HTTP and set state directly.
      useAuthStore.setState({
        user: {
          id: mockCurrentUser.id,
          email: mockCurrentUser.email,
          member: mockCurrentUser,
          isAdmin: mockCurrentUser.is_admin,
          activeCourseIds: [MOCK_COURSE_ID],
        },
        loading: false,
        initialized: true,
      })

      setReady(true)
    }

    init().catch(console.error)
  }, [isMockEnabled])

  // If mock is disabled, render immediately
  if (!isMockEnabled) return <>{children}</>

  // Hold render until MSW is ready so no requests escape before handlers are active
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <p className="text-green-900/40 text-sm font-sans">Starting mock server…</p>
      </div>
    )
  }

  return <>{children}</>
}
