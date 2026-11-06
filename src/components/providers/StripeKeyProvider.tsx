'use client'

// The Stripe publishable key, handed down from the (app) layout, which reads it
// on the server. It replaces the NEXT_PUBLIC_ variable that used to be compiled
// into the bundle: the key is still known on first paint, so the policy text
// doesn't wait on a request, but it isn't in the public JS files anymore.

import { createContext, useContext } from 'react'

const StripeKeyContext = createContext<string | null>(null)

export function StripeKeyProvider({
  publishableKey,
  children,
}: {
  publishableKey: string | null
  children: React.ReactNode
}) {
  return <StripeKeyContext.Provider value={publishableKey}>{children}</StripeKeyContext.Provider>
}

/** The publishable key, or null when Stripe isn't configured (or outside the provider). */
export function useStripePublishableKey(): string | null {
  return useContext(StripeKeyContext)
}
