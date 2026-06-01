'use client'

import Logo from '@/components/ui/Logo'

export default function OfflinePage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-8 text-center"
      style={{ background: '#F4F1E8' }}
    >
      <Logo size={72} className="mb-6" variant="full-color" />

      <div className="text-5xl mb-5">📡</div>

      <h1 className="font-sans font-black text-2xl text-green-900 mb-3">You&apos;re offline</h1>
      <p className="text-sm leading-relaxed max-w-xs mb-8" style={{ color: 'rgba(26,46,26,0.55)' }}>
        It looks like you&apos;ve lost your internet connection. Please check your Wi-Fi or mobile data and try again.
      </p>

      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold"
        style={{ background: '#002669', color: '#85bb65' }}
      >
        Try again
      </button>
    </div>
  )
}
