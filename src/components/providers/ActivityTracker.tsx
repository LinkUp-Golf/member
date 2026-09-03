'use client'

// ============================================================
// Records which areas of the member app each member actually
// visits. Mounted once in the (app) layout — it renders nothing
// and only reacts to navigation.
//
// Admin routes live in their own route group and are not mounted
// here, so an admin's time in the back office never lands in the
// member usage report.
// ============================================================

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useUser } from '@/contexts/AuthContext'
import { activityForPath } from '@/lib/activity/areas'
import { trackActivity } from '@/lib/activity/track'

export default function ActivityTracker() {
  const { user, loading } = useUser()
  const pathname = usePathname()

  useEffect(() => {
    // Wait for auth to resolve — firing early just earns a 401 and loses
    // the first page of the session, which is the one worth having.
    if (loading || !user || !pathname) return

    const activity = activityForPath(pathname)
    if (!activity) return

    trackActivity(activity.action, { targetId: activity.targetId ?? null, path: pathname })
  }, [pathname, user, loading])

  return null
}
