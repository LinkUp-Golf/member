'use client'

import { useEffect } from 'react'

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV === 'development') {
      // Unregister any stale service workers in dev so precache mismatches
      // after rebuilds don't cause 404 errors in the console.
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister())
      })
      return
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  }, [])

  return null
}
