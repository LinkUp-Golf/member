'use client'

import { useEffect, useState } from 'react'

export type InstallPlatform =
  | 'ios-safari'   // Safari on iOS — can install via Share sheet
  | 'ios-other'    // Chrome/Firefox/in-app browser on iOS — must open in Safari first
  | 'android'      // Android Chrome — beforeinstallprompt available
  | 'desktop'      // Desktop browser
  | 'unknown'

export function useInstallState() {
  const [platform, setPlatform] = useState<InstallPlatform>('unknown')
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const ua = window.navigator.userAgent

    const isIOS = /iphone|ipad|ipod/i.test(ua)
    const isAndroid = /android/i.test(ua)

    // In-app browsers and non-Safari iOS browsers can't trigger Add to Home Screen
    const isIOSChrome   = /CriOS/i.test(ua)
    const isIOSFirefox  = /FxiOS/i.test(ua)
    const isIOSEdge     = /EdgiOS/i.test(ua)
    const isInAppBrowser = /FBAN|FBAV|Instagram|Twitter|Line|WhatsApp|Snapchat/i.test(ua)
    const isIOSSafari   = isIOS && !isIOSChrome && !isIOSFirefox && !isIOSEdge && !isInAppBrowser

    if (isIOS) {
      setPlatform(isIOSSafari ? 'ios-safari' : 'ios-other')
    } else if (isAndroid) {
      setPlatform('android')
    } else {
      setPlatform('desktop')
    }

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true

    setIsStandalone(standalone)
  }, [])

  return { platform, isStandalone }
}
