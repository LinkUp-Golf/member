'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/store/auth'

// Initializes Supabase auth session and subscribes to auth state
// changes for the lifetime of the app. Placed in the root layout so
// session data is available on every route — including login, error,
// and membership-required pages.
export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const { initialize, initialized } = useAuthStore()

  useEffect(() => {
    if (!initialized) initialize()
  }, [initialize, initialized])

  return <>{children}</>
}
