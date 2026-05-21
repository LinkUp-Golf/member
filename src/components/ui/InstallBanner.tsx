'use client'

import { useState, useEffect } from 'react'
import { useInstallState } from '@/hooks/useInstallState'
import { useAndroidInstall } from '@/hooks/useAndroidInstall'

const DISMISSED_KEY = 'install_banner_dismissed_at'
const REDISPLAY_MS = 7 * 24 * 60 * 60 * 1000 // re-show after 7 days

export default function InstallBanner() {
  const { platform, isStandalone } = useInstallState()
  const { canInstall, promptInstall } = useAndroidInstall()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone) return
    if (platform === 'desktop' || platform === 'unknown') return

    const dismissed = localStorage.getItem(DISMISSED_KEY)
    if (dismissed && Date.now() - Number(dismissed) < REDISPLAY_MS) return

    setVisible(true)
  }, [platform, isStandalone])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    setVisible(false)
  }

  async function handleInstall() {
    if (platform === 'android' && canInstall) {
      await promptInstall()
      dismiss()
    } else {
      window.location.href = '/install'
    }
  }

  if (!visible) return null

  const label =
    platform === 'android' && canInstall
      ? 'Install App'
      : 'Add to Home Screen'

  const subtitle =
    platform === 'ios-other'
      ? 'Open in Safari to install'
      : platform === 'ios-safari'
      ? 'Tap Share → Add to Home Screen'
      : 'Get the full app experience'

  return (
    <div className="mx-4 mb-3 rounded-xl border border-green-800/20 bg-green-900/5 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-green-900">Install LinkUp Golf</p>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <button
        onClick={handleInstall}
        className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
        style={{ background: '#1A2E1A' }}
      >
        {label}
      </button>
      <button onClick={dismiss} className="flex-shrink-0 text-gray-300 hover:text-gray-500 text-lg leading-none">
        ×
      </button>
    </div>
  )
}
