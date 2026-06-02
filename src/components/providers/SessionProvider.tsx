'use client'

import { AuthProvider } from '@/contexts/AuthContext'
import { ProfileProvider } from '@/contexts/ProfileContext'

// In mock mode (dev only) MockProvider injects its own AuthContext /
// ProfileContext values from the outside, so we skip the real providers here
// to avoid overriding them with the real Supabase listener.
const isMock =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_MOCK !== 'false'

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  if (isMock) return <>{children}</>

  return (
    <AuthProvider>
      <ProfileProvider>
        {children}
      </ProfileProvider>
    </AuthProvider>
  )
}
