// ============================================================
// LinkUp Golf — Auth Store (Zustand)
// Global session state. Import useAuthStore in any component.
// ============================================================

import { create } from 'zustand'
import { createClient } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import type { SessionUser, MemberWithProfile } from '@/types'

interface AuthState {
  user: SessionUser | null
  loading: boolean
  initialized: boolean

  // Actions
  initialize: () => Promise<void>
  signOut: () => Promise<void>
  refreshMember: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  initialized: false,

  initialize: async () => {
    // Guard against concurrent calls (React Strict Mode double-invoke, etc.)
    if (get().initialized) return

    const supabase = createClient()

    // Wire the global API interceptor: when any API call returns 403
    // MEMBERSHIP_REVOKED, sign out and redirect without any per-page handling.
    apiClient.configure({
      onMembershipRevoked: async () => {
        await supabase.auth.signOut()
        useAuthStore.setState({ user: null, loading: false, initialized: true })
        window.location.href = '/membership-required'
      },
    })

    // Race the auth call against a 10-second timeout so a slow/unavailable
    // Supabase instance never leaves the app permanently stuck on the loader.
    const authTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000))

    try {
      const result = await Promise.race([
        supabase.auth.getUser(),
        authTimeout.then(() => null),
      ])

      const user = result && 'data' in result ? result.data.user : null
      const error = result && 'error' in result ? result.error : null

      if (error || !user) {
        set({ user: null, loading: false, initialized: true })
      } else {
        const member = await fetchMemberWithProfile(user.id)
        set({
          user: member ? buildSessionUser(user.email!, member) : null,
          loading: false,
          initialized: true,
        })
      }
    } catch {
      // Network error or unexpected throw — unblock the UI so pages can redirect
      set({ user: null, loading: false, initialized: true })
    }

    // Listen for auth changes (registered after initial state is resolved)
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const member = await fetchMemberWithProfile(session.user.id)
        if (member) {
          set({ user: buildSessionUser(session.user.email!, member) })
        }
      } else if (event === 'SIGNED_OUT') {
        set({ user: null })
      }
    })
  },

  signOut: async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    set({ user: null })
  },

  refreshMember: async () => {
    const { user } = get()
    if (!user) return
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return
    const member = await fetchMemberWithProfile(authUser.id)
    if (member) {
      set({ user: buildSessionUser(authUser.email!, member) })
    }
  },
}))

// ---- Helpers ------------------------------------------------

async function fetchMemberWithProfile(userId: string): Promise<MemberWithProfile | null> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('members')
      .select(`
        *,
        profile:member_profiles(*),
        home_course:courses(*)
      `)
      .eq('id', userId)
      .single()
    if (error || !data) return null
    return data as MemberWithProfile
  } catch {
    return null
  }
}

function buildSessionUser(email: string, member: MemberWithProfile): SessionUser {
  return {
    id: member.id,
    email,
    member,
    isAdmin: member.is_admin ?? false,
    activeCourseIds: [], // populated separately from course_memberships
  }
}
