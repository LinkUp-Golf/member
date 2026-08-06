'use client'

// Host credits. The wallet itself is shared with the partner workspace — see
// CreditsWallet — because it's the same member-scoped balance behind both.

import CreditsWallet from '@/components/credits/CreditsWallet'

export default function HostCreditsPage() {
  return (
    <CreditsWallet
      basePath="/api/host"
      earnedHint="credits appear here once an admin approves a completed event."
    />
  )
}
