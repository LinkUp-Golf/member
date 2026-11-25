'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'

interface AuthContextValue {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
})

// How long each half of signing out may take before we leave without it.
const SIGN_OUT_STEP_TIMEOUT_MS = 3_000

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    work,
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms)),
  ])
}

// Ends the session, and always returns: the caller navigates away afterwards
// whatever happened here. Signing out used to await the browser client first
// and redirect only if every step succeeded — and the browser client can
// stall (waiting on its own start-up, or on an auth lock another tab or a
// token refresh holds) or throw (a lock that times out). Either one left the
// member on the page with a Sign out button that did nothing.
//
// The server route goes first because it is what actually signs the device
// out: it expires the sb- cookies the middleware reads. The browser client's
// sign-out is then local-only (no network call) and best-effort, to drop the
// in-memory session and stop its refresh timer before we leave the page.
export async function endSession() {
  const controller = new AbortController()
  const abort = setTimeout(() => controller.abort(), SIGN_OUT_STEP_TIMEOUT_MS)
  try {
    await fetch('/api/auth/signout', { method: 'POST', signal: controller.signal })
  } catch (err) {
    console.error('Sign out: server route failed', err)
  } finally {
    clearTimeout(abort)
  }

  try {
    await withTimeout(
      createClient().auth.signOut({ scope: 'local' }),
      SIGN_OUT_STEP_TIMEOUT_MS,
    )
  } catch (err) {
    console.error('Sign out: browser client failed', err)
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    apiClient.configure({
      onMembershipRevoked: async () => {
        await endSession()
        setUser(null)
        window.location.href = '/membership-required'
      },
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        setUser(session?.user ?? null)
        setLoading(false)
      } else if (event === 'SIGNED_IN') {
        setUser(session?.user ?? null)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
      }
    })

    // Safety net: unblock UI if INITIAL_SESSION never fires (SDK edge case)
    const timeout = setTimeout(() => setLoading(false), 8_000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function signOut() {
    await endSession()
    setUser(null)
    window.location.replace('/login')
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useUser() {
  return useContext(AuthContext)
}
