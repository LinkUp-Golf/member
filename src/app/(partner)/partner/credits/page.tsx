'use client'

// Referral partner credits. Commission is paid as credit, so this is where a
// partner sees and spends it. Same member-scoped wallet the host workspace
// shows — a partner who also hosts sees one balance, not two.

import CreditsWallet from '@/components/credits/CreditsWallet'

export default function PartnerCreditsPage() {
  return (
    <CreditsWallet
      basePath="/api/partner"
      earnedHint="credits appear here once the LinkUp team pays out your commission."
    />
  )
}
