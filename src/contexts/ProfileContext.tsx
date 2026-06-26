'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
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

  const doFetch = useCallback(async () => {
    if (!user) {
      setProfile(null)
      return
    }

    setError(null)

    // Mirror the original 3-attempt retry with exponential back-off so
    // transient Supabase cold-start / network hiccups don't permanently fail.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const supabase = createClient()
        const { data, error: dbError } = await supabase
          .from('members')
          .select('*, profile:member_profiles(*), home_course:courses!members_home_course_id_fkey(*)')
          .eq('id', user.id)
          .single()

        if (!dbError && data) {
          setProfile(data as MemberWithProfile)
          return
        }

        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 500 * attempt))
        } else {
          setError('Failed to load profile')
          setProfile(null)
        }
      } catch {
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 500 * attempt))
        } else {
          setError('Failed to load profile')
        }
      }
    }
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
