import type { User } from '@supabase/supabase-js'
import { useUser } from '@/contexts/AuthContext'
import { useProfileContext } from '@/contexts/ProfileContext'
import type { MemberWithProfile } from '@/types'

export interface UseProfileResult {
  /** Supabase Auth user — identity only (id, email). Null while loading or unauthenticated. */
  user: User | null
  /** Full member row joined with member_profiles and home course. Null while loading or unauthenticated. */
  profile: MemberWithProfile | null
  /** True until both auth state and the profile row have resolved. */
  loading: boolean
  error: string | null
  isAdmin: boolean
  signOut: () => Promise<void>
  /** Silently re-fetches the profile without triggering the loading state. */
  refetch: () => Promise<void>
}

export function useProfile(): UseProfileResult {
  const { user, loading: authLoading, signOut } = useUser()
  const { profile, loading: profileLoading, error, refetch } = useProfileContext()

  return {
    user,
    profile,
    loading: authLoading || profileLoading,
    error,
    isAdmin: profile?.is_admin ?? false,
    signOut,
    refetch,
  }
}
