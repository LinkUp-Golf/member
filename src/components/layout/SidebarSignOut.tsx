'use client'

// Sign out, for the dark workspace sidebars (member, host, partner, admin).
//
// The member app's own sign-out lives on the /more hub — a page that only
// exists as a destination for the mobile bottom nav. From tablet up the
// sidebar lists the More items directly and /more is never visited, so the
// web view had no way out of the session at all; the host, partner and admin
// shells never had one either. This is that control, in the one place every
// one of those shells already has a footer.

import { LogOut } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

export default function SidebarSignOut() {
  const { signOut } = useProfile()

  return (
    <button
      type="button"
      onClick={signOut}
      className="focus-ring flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors rounded-lg"
    >
      <LogOut className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
      Sign out
    </button>
  )
}
