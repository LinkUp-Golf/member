'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useUser } from './AuthContext'
import type { MemberWithProfile } from '@/types'

interface ProfileContextValue {
  profile: MemberWithProfile | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  loading: true,
  error: null,
  refetch: async () => {},
})

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useUser()
  const [profile, setProfile] = useState<MemberWithProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Each fetch takes a ticket; only the newest may write state, so a slow or
  // retrying fetch for a user who has since signed out (or been replaced by a
  // different signed-in user) can't clobber it with stale data.
  const requestSeqRef = useRef(0)

  // Read through the server, not the browser Supabase client. The server reads
  // the session from the cookie — the same one the middleware and every API
  // route use — so a stalled or stale browser session can no longer leave the
  // app working but the profile empty (a blank Profile screen and no Admin
  // entry in the menu). See src/app/api/members/me/route.ts.
  //
  // It runs whether or not the browser client reports a user: that report is
  // exactly what goes missing when the browser session is stuck, and the
  // cookie is the authority. With no session the route answers 401 and the
  // profile is null, as before.
  const doFetch = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setError(null)

    // 3 attempts with back-off, so a cold start or network blip doesn't stick.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('/api/members/me', {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (seq !== requestSeqRef.current) return // stale — a newer fetch owns state now

        if (res.ok) {
          setProfile((await res.json()) as MemberWithProfile)
          return
        }

        // Signed out, or no member row: retrying won't change the answer.
        if (res.status === 401 || res.status === 403) {
          setProfile(null)
          return
        }
      } catch {
        if (seq !== requestSeqRef.current) return
      }

      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 500 * attempt))
        if (seq !== requestSeqRef.current) return
      } else {
        setError('Failed to load profile')
      }
    }
  // Keyed on the user id so signing in or out re-reads the profile.
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (authLoading) return
    setProfileLoading(true)
    doFetch().finally(() => setProfileLoading(false))
  }, [authLoading, doFetch])

  // refetch silently re-fetches without triggering the loading state,
  // so components updating a profile don't flash a spinner.
  const refetch = useCallback(async () => {
    await doFetch()
  }, [doFetch])

  return (
    <ProfileContext.Provider
      value={{ profile, loading: authLoading || profileLoading, error, refetch }}
    >
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfileContext() {
  return useContext(ProfileContext)
}
