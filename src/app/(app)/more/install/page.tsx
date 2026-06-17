'use client'

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import { useInstallState } from '@/hooks/useInstallState'
import { useAndroidInstall } from '@/hooks/useAndroidInstall'

export default function InstallAppPage() {
  const { platform, isStandalone } = useInstallState()
  const { canInstall, promptInstall } = useAndroidInstall()

  return (
    <AppShell title="Install App" description="Add to your home screen">
      <div className="px-5 py-6 max-w-sm">
        {platform === 'unknown' ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 rounded-full border-2 border-green-900/20 border-t-green-900 animate-spin" />
          </div>
        ) : isStandalone ? (
          <AlreadyInstalled />
        ) : platform === 'android' ? (
          <AndroidInstructions canInstall={canInstall} promptInstall={promptInstall} />
        ) : platform === 'ios-safari' ? (
          <IOSSafariInstructions />
        ) : platform === 'ios-other' ? (
          <IOSOtherInstructions />
        ) : (
          <DesktopInstructions />
        )}
      </div>
    </AppShell>
  )
}

function AlreadyInstalled() {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl"
        style={{ background: 'rgba(0,38,105,0.05)' }}>
        ✓
      </div>
      <h2 className="font-sans font-black text-xl mb-2" style={{ color: 'var(--color-green-900)' }}>
        Already installed
      </h2>
      <p className="text-sm" style={{ color: 'rgba(0,38,105,0.5)' }}>
        LinkUp Golf is already on your home screen.
      </p>
    </div>
  )
}

function AndroidInstructions({ canInstall, promptInstall }: { canInstall: boolean; promptInstall: () => void }) {
  return (
    <div>
      <h2 className="font-sans font-black text-xl mb-1.5" style={{ color: 'var(--color-green-900)' }}>
        Install on Android
      </h2>
      <p className="text-sm mb-6" style={{ color: 'rgba(0,38,105,0.5)' }}>
        Add LinkUp Golf to your home screen for the best experience.
      </p>
      {canInstall ? (
        <button
          onClick={promptInstall}
          className="w-full py-3.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--color-green-900)' }}
        >
          Install App
        </button>
      ) : (
        <ol className="space-y-4">
          <Step n={1}>Open this page in <strong>Chrome</strong></Step>
          <Step n={2}>Tap the <strong>⋮ menu</strong> in the top-right corner</Step>
          <Step n={3}>Tap <strong>&ldquo;Add to Home screen&rdquo;</strong></Step>
          <Step n={4}>Tap <strong>Add</strong> to confirm</Step>
        </ol>
      )}
    </div>
  )
}

function IOSSafariInstructions() {
  return (
    <div>
      <h2 className="font-sans font-black text-xl mb-1.5" style={{ color: 'var(--color-green-900)' }}>
        Install on iPhone
      </h2>
      <p className="text-sm mb-6" style={{ color: 'rgba(0,38,105,0.5)' }}>
        Follow these steps in Safari to add LinkUp to your home screen.
      </p>
      <ol className="space-y-4">
        <Step n={1}>Tap the <strong>Share</strong> button <ShareIcon /> at the bottom of Safari</Step>
        <Step n={2}>Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></Step>
        <Step n={3}>Tap <strong>Add</strong> in the top-right corner</Step>
      </ol>
      <p className="mt-6 text-xs text-center" style={{ color: 'rgba(0,38,105,0.35)' }}>
        The LinkUp icon will appear on your home screen.
      </p>
    </div>
  )
}

function IOSOtherInstructions() {
  return (
    <div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-medium text-amber-800">Open this page in Safari</p>
        <p className="text-xs text-amber-700 mt-1">
          Your current browser doesn&apos;t support installing apps. Copy the link and paste it into <strong>Safari</strong>.
        </p>
      </div>
      <h2 className="font-sans font-black text-xl mb-4" style={{ color: 'var(--color-green-900)' }}>
        Then in Safari:
      </h2>
      <ol className="space-y-4">
        <Step n={1}>Tap the <strong>Share</strong> button <ShareIcon /> at the bottom</Step>
        <Step n={2}>Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></Step>
        <Step n={3}>Tap <strong>Add</strong></Step>
      </ol>
    </div>
  )
}

function DesktopInstructions() {
  const [installUrl, setInstallUrl] = useState('')

  useEffect(() => {
    setInstallUrl(window.location.origin + '/install')
  }, [])

  return (
    <div>
      <h2 className="font-sans font-black text-xl mb-1.5" style={{ color: 'var(--color-green-900)' }}>
        Open on your phone
      </h2>
      <p className="text-sm mb-6" style={{ color: 'rgba(0,38,105,0.5)' }}>
        Visit this link on your iPhone or Android to install LinkUp Golf.
      </p>
      {installUrl && (
        <div className="bg-white rounded-xl border px-4 py-3 text-sm font-mono break-all"
          style={{ color: 'rgba(0,38,105,0.6)', borderColor: 'rgba(0,38,105,0.08)' }}>
          {installUrl}
        </div>
      )}
      <p className="mt-4 text-xs text-center" style={{ color: 'rgba(0,38,105,0.35)' }}>
        Or ask your admin for a QR code.
      </p>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ background: 'var(--color-green-900)' }}
      >
        {n}
      </span>
      <span className="text-sm pt-0.5" style={{ color: 'rgba(0,38,105,0.7)' }}>{children}</span>
    </li>
  )
}

function ShareIcon() {
  return (
    <svg className="inline-block mx-0.5 align-text-bottom" width="15" height="15"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ color: '#007AFF' }}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}
