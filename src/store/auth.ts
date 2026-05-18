// ============================================================
// LinkUp Golf — Auth Store (Zustand)
// Global session state. Import useAuthStore in any component.
// ============================================================

import { create } from 'zustand'
import { createClient } from '@/lib/supabase'
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
    const supabase = createClient()

    // Get initial session
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const member = await fetchMemberWithProfile(user.id)
      if (member) {
        set({
          user: buildSessionUser(user.email!, member),
          loading: false,
          initialized: true,
        })
      } else {
        set({ user: null, loading: false, initialized: true })
      }
    } else {
      set({ user: null, loading: false, initialized: true })
    }

    // Listen for auth changes
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
