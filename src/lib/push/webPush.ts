// ============================================================
// web-push singleton
//
// Lazy-initialised once per serverless instance so VAPID key
// parsing (a synchronous crypto operation) happens only once.
// Never import this file in client components.
// ============================================================

import webpush from 'web-push'

let initialised = false

export function getWebPush(): typeof webpush {
  if (!initialised) {
    const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY
    const subject    = process.env.VAPID_SUBJECT
      ?? `mailto:${process.env.VAPID_CONTACT_EMAIL ?? 'hello@linkup.golf'}`

    if (!publicKey || !privateKey) {
      throw new Error(
        'Push notifications are not configured. ' +
        'Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in your environment.'
      )
    }

    webpush.setVapidDetails(subject, publicKey, privateKey)
    initialised = true
  }

  return webpush
}

// Exposed so tests can reset the singleton between test runs.
export function resetWebPush(): void {
  initialised = false
}
