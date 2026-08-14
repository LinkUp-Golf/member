'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useProfile } from '@/hooks/useProfile'

export interface MemberRoles {
  /** members.is_admin — grants /admin. */
  isAdmin: boolean
  /** Owns a referral_partners row — grants /partner. */
  isPartner: boolean
  /** Owns a hosts row — grants /host. */
  isHost: boolean
}

export interface UseMemberRolesResult extends MemberRoles {
  /** True until the role lookups resolve; isAdmin is available sooner. */
  loading: boolean
}

/**
 * The roles a member holds beyond plain membership, used to decide which
 * workspaces to surface in the nav.
 *
 * The partner and host roles are the existence of a referral_partners / hosts
 * row owned by the member, read directly through RLS (the owner-select policies)
 * rather than via an API route — this runs on every nav render, and a denied
 * read simply means "not in that role".
 *
 * This is nav-shaping only. The real gates are middleware (/admin, /partner,
 * /host) and withAuth on every API route.
 */
export function useMemberRoles(): UseMemberRolesResult {
  const { user, isAdmin, loading: profileLoading } = useProfile()
  const [isPartner, setIsPartner] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setIsPartner(false)
      setIsHost(false)
      setLoading(profileLoading)
      return
    }

    let cancelled = false
    const supabase = createClient()

    const check = () =>
      Promise.all([
        supabase.from('referral_partners').select('id').eq('member_id', user.id).maybeSingle(),
        // status matters: middleware and withHostAuth both require an *active*
        // host, so surfacing the workspace off the row's mere existence gave a
        // suspended host a Host entry in the nav that bounced them straight back.
        supabase.from('hosts').select('id').eq('member_id', user.id).eq('status', 'active').maybeSingle(),
      ]).then(([partnerRes, hostRes]) => {
        if (cancelled) return
        setIsPartner(!!partnerRes.data)
        setIsHost(!!hostRes.data)
        setLoading(false)
      })

    check()

    // Roles are granted by someone else (an admin approving an application), so
    // this has to re-check rather than wait to be told. AppNav is mounted in the
    // (app) layout and survives client-side navigation, so without this the check
    // ran once per hard load — an approved host kept seeing "Become a Host" and no
    // Host Dashboard entry for the rest of their session.
    const onFocus = () => {
      if (document.visibilityState === 'visible') check()
    }
    window.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      window.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [user, profileLoading])

  return { isAdmin, isPartner, isHost, loading }
}
