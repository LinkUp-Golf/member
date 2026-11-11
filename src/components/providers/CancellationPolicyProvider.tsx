'use client'

// Whether the cancellation policy is on, handed down from the (app) layout,
// which knows on the server (stripeEnabled()). Known on first paint, so the
// policy text on the confirm screen and in the cancel dialog never waits on a
// request.

import { createContext, useContext } from 'react'

const CancellationPolicyContext = createContext(false)

export function CancellationPolicyProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  return <CancellationPolicyContext.Provider value={enabled}>{children}</CancellationPolicyContext.Provider>
}

/** True when late cancellations are invoiced; false outside the provider. */
export function useCancellationPolicyOn(): boolean {
  return useContext(CancellationPolicyContext)
}
