'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useProfile } from '@/hooks/useProfile'

export interface MemberRoles {
  /** members.is_admin — grants /admin. */
  isAdmin: boolean
  /** Owns a referral_partners row — grants /partner. */
  isPartner: boolean
}

export interface UseMemberRolesResult extends MemberRoles {
  /** True until the partner lookup resolves; isAdmin is available sooner. */
  loading: boolean
}

/**
 * The roles a member holds beyond plain membership, used to decide which
 * workspaces to surface in the nav.
 *
 * The partner role is the existence of a referral_partners row owned by the
 * member, read directly through RLS (the owner-select policy added in
 * 20260719000001_referral_partner_applications.sql) rather than via an API
 * route — this runs on every nav render, and a denied read simply means
 * "not a partner".
 *
 * This is nav-shaping only. The real gates are middleware (/admin, /partner)
 * and withAuth on every API route.
 */
export function useMemberRoles(): UseMemberRolesResult {
  const { user, isAdmin, loading: profileLoading } = useProfile()
  const [isPartner, setIsPartner] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setIsPartner(false)
      setLoading(profileLoading)
      return
    }

    let cancelled = false
    const supabase = createClient()

    supabase
      .from('referral_partners')
      .select('id')
      .eq('member_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setIsPartner(!!data)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [user, profileLoading])

  return { isAdmin, isPartner, loading }
}
