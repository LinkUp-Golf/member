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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    apiClient.configure({
      onMembershipRevoked: async () => {
        await supabase.auth.signOut()
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
    const supabase = createClient()
    await supabase.auth.signOut()
    await fetch('/api/auth/signout', { method: 'POST' })
    setUser(null)
    window.location.href = '/login'
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
